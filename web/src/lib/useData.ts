import { useEffect, useState } from 'react'

export type Loaded<T> = { data: T | undefined; error: string | null; loading: boolean }

/** Loads `fn` whenever `deps` change; ignores answers that arrive after a newer request. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: null, loading: true })
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) => live && setState({ data: undefined, error: e instanceof Error ? e.message : String(e), loading: false }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
