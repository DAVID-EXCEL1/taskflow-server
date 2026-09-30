import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../services/api';

// Fetch helper: returns { data, loading, error, reload, pagination }.
export function useFetch(url, params, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null, pagination: null, extra: null });
  const key = JSON.stringify(params || {});
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) { setState({ data: null, loading: false, error: null, pagination: null, extra: null }); return; }
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get(url, { params: JSON.parse(key) });
      if (id === seq.current) setState({ data: data.data, loading: false, error: null, pagination: data.pagination, extra: data });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: errMsg(e) }));
    }
  }, [url, key]); // eslint-disable-line
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
