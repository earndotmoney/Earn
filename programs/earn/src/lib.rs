//! EARN — pump.fun creator fees, paid to the creator a token names.
//!
//! A creator account (an X, Twitch, GitHub, Spotify or fomo account) is identified by `key`, the
//! sha256 of `"<provider>:<stable id>"`. It owns two PDAs:
//!
//! - the **fee address** `["fee", key]` — system-owned, no data. A token launched for the creator
//!   sets it as its pump.fun `creator`, so pump.fun pays the creator fees here. Only this program
//!   can move lamports out of it (it signs for its own PDA), and only in `harvest`.
//! - the **account** `["account", key]` — program-owned. Holds the recipient's credited share and
//!   the ledger.
//!
//! `harvest` is permissionless and credits whatever reached the fee address: 100% to the
//! creator account; EARN takes no cut. `withdraw` needs the EARN signer — the server that checked the
//! creator's sign-in — as a co-signer of the transaction.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{load_current_index_checked, load_instruction_at_checked};
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_interface::TokenAccount;

declare_id!("irfCxPWpdsFS3fH73dfNZPpYfyABz5Xu1LYgtQnearn");

/// ⛔ EARN takes NO cut (operator, 27 Sep 2026): the named creator gets 100% of every harvest. Enforced
/// here, so no admin can ever configure a protocol share. `to_treasury` is therefore always zero.
pub const MIN_RECIPIENT_BPS: u16 = 10_000;
pub const BPS: u64 = 10_000;
/// Recipients per split. Eight keeps `harvest_split` in one small transaction.
pub const MAX_RECIPIENTS: usize = 8;
/// The withdrawal ceiling resets on this period.
pub const WINDOW_SECONDS: i64 = 86_400;

#[program]
pub mod earn {
    use super::*;

    /// Only the program's upgrade authority may initialise, so nobody can race the deploy and make
    /// themselves admin. The admin it names does not sign (it can be a wallet the deployer does not hold).
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, args: ConfigArgs) -> Result<()> {
        args.validate()?;
        require!(admin != Pubkey::default(), EarnError::ZeroAddress);
        let c = &mut ctx.accounts.config;
        c.bump = ctx.bumps.config;
        c.admin = admin;
        c.apply(args);
        Ok(())
    }

    pub fn set_config(ctx: Context<SetConfig>, args: ConfigArgs) -> Result<()> {
        args.validate()?;
        ctx.accounts.config.apply(args);
        emit!(ConfigChanged { recipient_bps: ctx.accounts.config.recipient_bps, paused: ctx.accounts.config.paused });
        Ok(())
    }

    /// Two-step so a typo cannot hand the program to nobody.
    pub fn propose_admin(ctx: Context<SetConfig>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = c.pending_admin;
        c.pending_admin = Pubkey::default();
        Ok(())
    }

    /// Splits everything above the rent floor that reached the fee address. Anyone may call it;
    /// the split is fixed by `config`, not by the caller.
    pub fn harvest(ctx: Context<Harvest>, key: [u8; 32]) -> Result<()> {
        let floor = Rent::get()?.minimum_balance(0);
        let fee = &ctx.accounts.fee_address;
        let gross = fee.lamports().saturating_sub(floor);
        // ⛔ A fee address below the floor must stay untouched: pump.fun skips a collection that
        // would leave a new account under rent, and a partial drain would strand it there.
        require!(gross > 0, EarnError::NothingToHarvest);

        let account = &mut ctx.accounts.account;
        if account.key == [0u8; 32] {
            account.key = key;
            account.bump = ctx.bumps.account;
            account.fee_bump = ctx.bumps.fee_address;
        }

        // u128: a u64 multiply would panic (overflow-checks) past ~1.8M SOL and brick harvest for that key.
        let to_recipient = (u128::from(gross) * u128::from(ctx.accounts.config.recipient_bps) / u128::from(BPS)) as u64;
        let to_treasury = gross - to_recipient;
        let seeds: &[&[u8]] = &[b"fee", &key, &[ctx.bumps.fee_address]];
        let sys = ctx.accounts.system_program.to_account_info();
        transfer(
            CpiContext::new_with_signer(sys.clone(), Transfer { from: fee.to_account_info(), to: account.to_account_info() }, &[seeds]),
            to_recipient,
        )?;
        if to_treasury > 0 {
            transfer(
                CpiContext::new_with_signer(sys, Transfer { from: fee.to_account_info(), to: ctx.accounts.treasury.to_account_info() }, &[seeds]),
                to_treasury,
            )?;
        }

        account.claimed = account.claimed.checked_add(gross).ok_or(EarnError::Overflow)?;
        account.credited = account.credited.checked_add(to_recipient).ok_or(EarnError::Overflow)?;
        emit!(Claimed { key, gross, to_recipient, to_treasury });
        Ok(())
    }

    /// Creates a creator's account without a harvest, so it can receive shares of a split.
    pub fn init_account(ctx: Context<InitAccount>, key: [u8; 32]) -> Result<()> {
        let account = &mut ctx.accounts.account;
        if account.key == [0u8; 32] {
            account.key = key;
            account.bump = ctx.bumps.account;
            account.fee_bump = Pubkey::find_program_address(&[b"fee", &key], &crate::ID).1;
        }
        Ok(())
    }

    /// Registers a fee split: 2 to 8 creator accounts whose shares add up to exactly 100%.
    ///
    /// The split is content-addressed: `split_key` must be the sha256 of the recipients (keys in
    /// ascending order, each followed by its share), so one list has one address, anyone can create
    /// it, and a token whose fee address is `["fee", split_key]` can only ever be divided this way.
    pub fn create_split(ctx: Context<CreateSplit>, split_key: [u8; 32], recipients: Vec<Recipient>) -> Result<()> {
        require!(recipients.len() >= 2 && recipients.len() <= MAX_RECIPIENTS, EarnError::BadSplit);
        let mut total: u32 = 0;
        let mut bytes = Vec::with_capacity(recipients.len() * 34);
        for (i, r) in recipients.iter().enumerate() {
            require!(r.bps > 0, EarnError::BadSplit);
            // Strictly ascending keys: no duplicates, one canonical order.
            if i > 0 { require!(recipients[i - 1].key < r.key, EarnError::BadSplit); }
            total += u32::from(r.bps);
            bytes.extend_from_slice(&r.key);
            bytes.extend_from_slice(&r.bps.to_le_bytes());
        }
        require!(total == BPS as u32, EarnError::SplitNotWhole);
        let hash = anchor_lang::solana_program::hash::hash(&bytes).to_bytes();
        require!(hash == split_key, EarnError::WrongSplitKey);
        let split = &mut ctx.accounts.split;
        split.bump = ctx.bumps.split;
        split.split_key = split_key;
        split.recipients = recipients;
        Ok(())
    }

    /// Like `harvest`, for a split fee address: everything above the rent floor is divided by the
    /// registered shares into each recipient's account (the last one takes the rounding remainder,
    /// so the shares add up to the gross exactly). Anyone may call it.
    ///
    /// Remaining accounts: the recipients' `CreatorAccount`s, in the split's order, all initialised.
    pub fn harvest_split<'info>(ctx: Context<'_, '_, 'info, 'info, HarvestSplit<'info>>, split_key: [u8; 32]) -> Result<()> {
        let floor = Rent::get()?.minimum_balance(0);
        let fee = &ctx.accounts.fee_address;
        let gross = fee.lamports().saturating_sub(floor);
        require!(gross > 0, EarnError::NothingToHarvest);
        let split = &ctx.accounts.split;
        require!(ctx.remaining_accounts.len() == split.recipients.len(), EarnError::BadSplit);

        // One event for the split as a whole (attributes the fees to the token), then one per recipient.
        emit!(SplitClaimed { split_key, gross });
        let seeds: &[&[u8]] = &[b"fee", &split_key, &[ctx.bumps.fee_address]];
        let sys = ctx.accounts.system_program.to_account_info();
        let mut paid_out: u64 = 0;
        let last = split.recipients.len() - 1;
        for (i, r) in split.recipients.iter().enumerate() {
            let info = &ctx.remaining_accounts[i];
            // The account must be THE account for this recipient key: right owner, right address, right key.
            require!(info.owner == &crate::ID, EarnError::WrongAccount);
            let mut account: Account<'info, CreatorAccount> = Account::try_from(info)?;
            require!(account.key == r.key, EarnError::WrongAccount);
            let expected = Pubkey::create_program_address(&[b"account", &r.key, &[account.bump]], &crate::ID).map_err(|_| error!(EarnError::WrongAccount))?;
            require!(*info.key == expected, EarnError::WrongAccount);

            let share = if i == last { gross - paid_out } else { (u128::from(gross) * u128::from(r.bps) / u128::from(BPS)) as u64 };
            paid_out += share;
            if share > 0 {
                transfer(CpiContext::new_with_signer(sys.clone(), Transfer { from: fee.to_account_info(), to: info.clone() }, &[seeds]), share)?;
            }
            account.claimed = account.claimed.checked_add(share).ok_or(EarnError::Overflow)?;
            account.credited = account.credited.checked_add(share).ok_or(EarnError::Overflow)?;
            account.exit(&crate::ID)?;
            emit!(Claimed { key: r.key, gross: share, to_recipient: share, to_treasury: 0 });
        }
        Ok(())
    }

    /// Pays `lamports` of the account's credited share. The EARN signer co-signs: it is the server
    /// that checked the creator's sign-in, and it chose `destination`.
    ///
    /// - `Sol`: lamports go straight to `destination`.
    /// - `Usdc`: lamports go to the relayer (fee payer), which must swap them in this same
    ///   transaction into `destination`, a USDC token account; a later `settle` instruction checks
    ///   it grew by at least `min_out`, or the whole transaction reverts.
    pub fn withdraw(ctx: Context<Withdraw>, key: [u8; 32], lamports: u64, mode: PayoutMode, min_out: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, EarnError::Paused);
        require!(lamports > 0, EarnError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        if now - config.window_start >= WINDOW_SECONDS {
            config.window_start = now;
            config.window_spent = 0;
        }
        config.window_spent = config.window_spent.checked_add(lamports).ok_or(EarnError::Overflow)?;
        require!(config.window_spent <= config.daily_cap, EarnError::DailyCapReached);

        let account = &mut ctx.accounts.account;
        require!(account.key == key, EarnError::WrongAccount);
        require!(account.pending_destination == Pubkey::default(), EarnError::SettlementPending);
        // ⛔ Paying the account itself, the config, or the fee address would book a payout that never
        // left (stranded) or one that harvest re-credits (double-counted). Refused even for the signer.
        let dest_key = ctx.accounts.destination.key();
        let fee_address = Pubkey::create_program_address(&[b"fee", &key, &[account.fee_bump]], &crate::ID)
            .map_err(|_| error!(EarnError::WrongDestination))?;
        require!(
            dest_key != account.key() && dest_key != ctx.accounts.config.key() && dest_key != fee_address && dest_key != crate::ID,
            EarnError::WrongDestination
        );
        let owed = account.credited - account.paid;
        require!(lamports <= owed, EarnError::MoreThanOwed);

        let to = match mode {
            PayoutMode::Sol => ctx.accounts.destination.to_account_info(),
            PayoutMode::Usdc => {
                require!(min_out > 0, EarnError::ZeroAmount);
                let dest = ctx.accounts.destination.to_account_info();
                let before = read_token_amount(&dest)?;
                account.pending_destination = dest.key();
                account.pending_min_balance = before.checked_add(min_out).ok_or(EarnError::Overflow)?;
                require_settle_follows(&ctx.accounts.instructions, &account.key(), &dest.key())?;
                ctx.accounts.relayer.to_account_info()
            }
        };

        account.paid += lamports;
        account.nonce += 1;
        **account.to_account_info().try_borrow_mut_lamports()? -= lamports;
        **to.try_borrow_mut_lamports()? += lamports;
        // Never leave the account itself below rent — the ledger has to survive.
        let floor = Rent::get()?.minimum_balance(account.to_account_info().data_len());
        require!(account.to_account_info().lamports() >= floor, EarnError::MoreThanOwed);

        emit!(Paid { key, lamports, mode, destination: ctx.accounts.destination.key(), min_out });
        Ok(())
    }

    /// Closes a `Usdc` withdrawal: the destination must now hold at least what `withdraw` required.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let account = &mut ctx.accounts.account;
        let dest = ctx.accounts.destination.to_account_info();
        require!(account.pending_destination == dest.key(), EarnError::WrongDestination);
        let now = read_token_amount(&dest)?;
        require!(now >= account.pending_min_balance, EarnError::SwapShort);
        account.pending_destination = Pubkey::default();
        account.pending_min_balance = 0;
        Ok(())
    }
}

/// USDC on Solana mainnet. The swap must land in a real token account of this mint.
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// The balance of a USDC token account. ⛔ Deserialising alone would accept any account whose bytes
/// look like one — the owner must be the token program and the mint must be USDC.
fn read_token_amount(info: &AccountInfo) -> Result<u64> {
    require!(*info.owner == anchor_spl::token::ID || *info.owner == anchor_spl::token_2022::ID, EarnError::WrongDestination);
    let data = info.try_borrow_data()?;
    let acc = TokenAccount::try_deserialize(&mut &data[..]).map_err(|_| error!(EarnError::WrongDestination))?;
    require!(acc.mint == USDC_MINT, EarnError::WrongDestination);
    Ok(acc.amount)
}

/// A `Usdc` withdrawal is only allowed if this same transaction closes it with `settle` for the
/// same account and destination — otherwise the relayer could take the SOL and never swap.
fn require_settle_follows(instructions: &AccountInfo, account: &Pubkey, destination: &Pubkey) -> Result<()> {
    let current = load_current_index_checked(instructions)? as usize;
    let mut i = current + 1;
    while let Ok(ix) = load_instruction_at_checked(i, instructions) {
        if ix.program_id == crate::ID
            && ix.data.len() >= 8
            && ix.data[..8] == *instruction::Settle::DISCRIMINATOR
            && ix.accounts.get(0).map(|a| a.pubkey) == Some(*account)
            && ix.accounts.get(1).map(|a| a.pubkey) == Some(*destination)
        {
            return Ok(());
        }
        i += 1;
    }
    err!(EarnError::SettleMissing)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PayoutMode {
    Sol,
    Usdc,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub signer: Pubkey,
    pub treasury: Pubkey,
    pub recipient_bps: u16,
    pub daily_cap: u64,
    pub paused: bool,
}

impl ConfigArgs {
    fn validate(&self) -> Result<()> {
        require!(self.recipient_bps >= MIN_RECIPIENT_BPS && u64::from(self.recipient_bps) <= BPS, EarnError::BadRecipientBps);
        require!(self.signer != Pubkey::default() && self.treasury != Pubkey::default(), EarnError::ZeroAddress);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub signer: Pubkey,
    pub treasury: Pubkey,
    pub recipient_bps: u16,
    pub paused: bool,
    pub daily_cap: u64,
    pub window_start: i64,
    pub window_spent: u64,
}

impl Config {
    fn apply(&mut self, a: ConfigArgs) {
        self.signer = a.signer;
        self.treasury = a.treasury;
        self.recipient_bps = a.recipient_bps;
        self.daily_cap = a.daily_cap;
        self.paused = a.paused;
    }
}

#[account]
#[derive(InitSpace)]
pub struct CreatorAccount {
    pub key: [u8; 32],
    pub bump: u8,
    pub fee_bump: u8,
    /// Gross fees ever harvested for this creator.
    pub claimed: u64,
    /// The recipient share of `claimed`.
    pub credited: u64,
    /// Everything withdrawn. `credited - paid` is owed.
    pub paid: u64,
    pub nonce: u64,
    pub pending_destination: Pubkey,
    pub pending_min_balance: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EarnError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::Earn>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EarnError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, constraint = config.pending_admin == pending_admin.key() @ EarnError::NotPendingAdmin)]
    pub config: Account<'info, Config>,
    pub pending_admin: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Recipient {
    pub key: [u8; 32],
    pub bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct Split {
    pub bump: u8,
    pub split_key: [u8; 32],
    #[max_len(8)]
    pub recipients: Vec<Recipient>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct InitAccount<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + CreatorAccount::INIT_SPACE, seeds = [b"account", key.as_ref()], bump)]
    pub account: Account<'info, CreatorAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(split_key: [u8; 32])]
pub struct CreateSplit<'info> {
    #[account(init, payer = payer, space = 8 + Split::INIT_SPACE, seeds = [b"split", split_key.as_ref()], bump)]
    pub split: Account<'info, Split>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(split_key: [u8; 32])]
pub struct HarvestSplit<'info> {
    #[account(mut, seeds = [b"fee", split_key.as_ref()], bump)]
    pub fee_address: SystemAccount<'info>,
    #[account(seeds = [b"split", split_key.as_ref()], bump = split.bump)]
    pub split: Account<'info, Split>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct Harvest<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"fee", key.as_ref()], bump)]
    pub fee_address: SystemAccount<'info>,
    #[account(init_if_needed, payer = payer, space = 8 + CreatorAccount::INIT_SPACE, seeds = [b"account", key.as_ref()], bump)]
    pub account: Account<'info, CreatorAccount>,
    /// CHECK: must be the configured treasury.
    #[account(mut, address = config.treasury @ EarnError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = signer @ EarnError::WrongSigner)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"account", key.as_ref()], bump = account.bump)]
    pub account: Account<'info, CreatorAccount>,
    pub signer: Signer<'info>,
    /// Pays the transaction fee; receives the lamports to swap in `Usdc` mode.
    #[account(mut)]
    pub relayer: Signer<'info>,
    /// CHECK: chosen by the signer. A wallet (`Sol`) or a USDC token account (`Usdc`).
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar, to find the closing `settle`.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [b"account", account.key.as_ref()], bump = account.bump)]
    pub account: Account<'info, CreatorAccount>,
    /// CHECK: compared against the pending destination and read as a token account.
    pub destination: UncheckedAccount<'info>,
}

#[event]
pub struct Claimed {
    pub key: [u8; 32],
    pub gross: u64,
    pub to_recipient: u64,
    pub to_treasury: u64,
}

#[event]
pub struct SplitClaimed {
    pub split_key: [u8; 32],
    pub gross: u64,
}

#[event]
pub struct Paid {
    pub key: [u8; 32],
    pub lamports: u64,
    pub mode: PayoutMode,
    pub destination: Pubkey,
    pub min_out: u64,
}

#[event]
pub struct ConfigChanged {
    pub recipient_bps: u16,
    pub paused: bool,
}

#[error_code]
pub enum EarnError {
    #[msg("The creator gets 100%: EARN takes no cut")]
    BadRecipientBps,
    #[msg("Zero address")]
    ZeroAddress,
    #[msg("Nothing above the rent floor to harvest")]
    NothingToHarvest,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Withdrawals are paused")]
    Paused,
    #[msg("Amount must be above zero")]
    ZeroAmount,
    #[msg("Daily withdrawal ceiling reached")]
    DailyCapReached,
    #[msg("Account does not match key")]
    WrongAccount,
    #[msg("A USDC withdrawal on this account is still open")]
    SettlementPending,
    #[msg("More than the account is owed")]
    MoreThanOwed,
    #[msg("Destination is not the pending one, or not a token account")]
    WrongDestination,
    #[msg("The swap delivered less than the minimum")]
    SwapShort,
    #[msg("A USDC withdrawal must be closed by settle in the same transaction")]
    SettleMissing,
    #[msg("Not the configured treasury")]
    WrongTreasury,
    #[msg("Not the configured signer")]
    WrongSigner,
    #[msg("Not the pending admin")]
    NotPendingAdmin,
    #[msg("Only the program's upgrade authority can initialise")]
    NotUpgradeAuthority,
    #[msg("A split has 2 to 8 distinct recipients in ascending key order, each with a share above zero")]
    BadSplit,
    #[msg("The shares must add up to exactly 100%")]
    SplitNotWhole,
    #[msg("split_key is not the hash of these recipients")]
    WrongSplitKey,
}
