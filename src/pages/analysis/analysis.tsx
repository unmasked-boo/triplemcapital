import React, { useEffect, useMemo, useRef, useState } from 'react';
import './analysis.scss';

type Tick = { quote: number | string; pipSize?: number };
type Market = { symbol: string; name: string; pipSize?: number };

const WS_URL = 'wss://ws.binaryws.com/websockets/v3';
const MIN_WINDOW = 50;
const MAX_WINDOW = 5000;

const lastDigit = (quote: Tick['quote'], pipSize?: number) => {
    if (quote === null || quote === undefined) return null;
    const value = Number.isInteger(pipSize) && pipSize! >= 0 ? Number(quote).toFixed(pipSize) : String(quote);
    const digits = value.replace(/\D/g, '');
    return digits ? Number(digits[digits.length - 1]) : null;
};

const digitStats = (ticks: Tick[]) => {
    const counts = Array(10).fill(0) as number[];
    ticks.forEach(tick => {
        const digit = lastDigit(tick.quote, tick.pipSize);
        if (digit !== null) counts[digit] += 1;
    });
    return counts.map((count, digit) => ({ digit, count, percentage: ticks.length ? (count / ticks.length) * 100 : 0 }));
};

const Analysis = () => {
    const socket = useRef<WebSocket | null>(null);
    const requestId = useRef(0);
    const [markets, setMarkets] = useState<Market[]>([]);
    const [symbol, setSymbol] = useState('');
    const [windowSize, setWindowSize] = useState(1000);
    const [ticks, setTicks] = useState<Tick[]>([]);
    const [quote, setQuote] = useState<number | string | null>(null);
    const [status, setStatus] = useState('connecting');
    const [error, setError] = useState('');

    useEffect(() => {
        const ws = new WebSocket(WS_URL);
        socket.current = ws;
        ws.onopen = () => {
            setStatus('connected');
            ws.send(JSON.stringify({ active_symbols: 'brief', req_id: ++requestId.current }));
        };
        ws.onerror = () => {
            setStatus('error');
            setError('Unable to connect to the Deriv market stream.');
        };
        ws.onclose = () => setStatus('disconnected');
        ws.onmessage = event => {
            const data = JSON.parse(event.data);
            if (data.error) return setError(data.error.message || 'Deriv API error.');
            if (data.msg_type === 'active_symbols') {
                const list = (data.active_symbols || []).map((item: Record<string, unknown>) => ({
                    symbol: String(item.symbol || item.underlying_symbol || ''),
                    name: String(item.display_name || item.underlying_symbol_name || item.symbol || ''),
                    pipSize: Number(item.pip_size ?? item.pip),
                })).filter((item: Market) => /volatility/i.test(item.name) || /HZ|R_/.test(item.symbol));
                setMarkets(list.sort((a: Market, b: Market) => a.name.localeCompare(b.name, undefined, { numeric: true })));
                if (list.length) setSymbol(current => current || list[0].symbol);
            }
            if (data.msg_type === 'history') {
                const history = (data.history?.prices || []).map((price: number | string, index: number) => ({ quote: price, pipSize: data.history.pip_size, epoch: data.history.times?.[index] }));
                setTicks(history.slice(-windowSize));
                if (history.length) setQuote(history[history.length - 1].quote);
            }
            if (data.msg_type === 'tick' && data.tick) {
                setQuote(data.tick.quote);
                setTicks(current => [...current, { quote: data.tick.quote, pipSize: data.tick.pip_size }].slice(-windowSize));
            }
        };
        return () => ws.close();
    }, []);

    useEffect(() => {
        if (status !== 'connected' || !symbol || !socket.current) return;
        setTicks([]);
        socket.current.send(JSON.stringify({ forget_all: 'ticks', req_id: ++requestId.current }));
        socket.current.send(JSON.stringify({ ticks_history: symbol, count: windowSize, end: 'latest', style: 'ticks', req_id: ++requestId.current }));
        socket.current.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: ++requestId.current }));
    }, [symbol, windowSize, status]);

    const stats = useMemo(() => digitStats(ticks), [ticks]);
    const activeStats = stats.filter(item => item.count > 0);
    const most = activeStats.length ? activeStats.reduce((a, b) => b.count > a.count ? b : a) : null;
    const least = activeStats.length ? activeStats.reduce((a, b) => b.count < a.count ? b : a) : null;
    const even = ticks.filter(tick => { const digit = lastDigit(tick.quote, tick.pipSize); return digit !== null && digit % 2 === 0; }).length;
    const odd = ticks.filter(tick => { const digit = lastDigit(tick.quote, tick.pipSize); return digit !== null && digit % 2 !== 0; }).length;
    const totalParity = even + odd;

    return <section className='analysis-section' aria-labelledby='analysis-title'>
        <div className='analysis-header'><div><p className='analysis-eyebrow'>Market intelligence</p><h1 id='analysis-title'>Analysis</h1><p className='analysis-subtitle'>Live digit distribution from the Deriv tick stream.</p></div><span className={`analysis-status ${status}`}><i />{status}</span></div>
        <div className='analysis-controls'><label>Market<select value={symbol} onChange={event => setSymbol(event.target.value)}><option value=''>{markets.length ? 'Select market' : 'Loading markets...'}</option>{markets.map(market => <option key={market.symbol} value={market.symbol}>{market.name}</option>)}</select></label><label>Ticks window<input type='number' min={MIN_WINDOW} max={MAX_WINDOW} value={windowSize} onChange={event => setWindowSize(Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Number(event.target.value) || MIN_WINDOW)))} /></label><div className='analysis-quote'><span>Latest quote</span><strong>{quote === null ? '--' : quote}</strong></div></div>
        <div className='analysis-grid'><div className='analysis-card analysis-card-wide'><div className='card-heading'><div><h2>Digit distribution</h2><p>Last {windowSize} ticks</p></div><span>{ticks.length}/{windowSize}</span></div><div className='digit-grid'>{stats.map(item => <div className={`digit-stat ${most?.digit === item.digit ? 'most' : ''} ${least?.digit === item.digit ? 'least' : ''}`} key={item.digit}><div className='digit-circle'><strong>{item.digit}</strong><small>{item.percentage.toFixed(1)}%</small></div><div className='digit-bar'><span style={{ width: `${item.percentage}%` }} /></div></div>)}</div></div><div className='analysis-card'><div className='card-heading'><div><h2>Even / odd</h2><p>Parity balance</p></div><span>{totalParity} valid</span></div><div className='parity-row'><div><strong>{even}</strong><span>Even</span></div><div><strong>{odd}</strong><span>Odd</span></div></div><div className='parity-bar'><span className='even' style={{ width: `${totalParity ? (even / totalParity) * 100 : 0}%` }} /><span className='odd' /></div></div><div className='analysis-card analysis-insight'><p className='analysis-eyebrow'>Snapshot</p><h2>{most ? `Digit ${most.digit} is most frequent` : 'Waiting for ticks'}</h2><p>{least ? `Digit ${least.digit} currently has the lowest frequency in this window.` : 'Choose a market to begin the analysis.'}</p></div></div>{error && <div className='analysis-error' role='alert'>{error}</div>}<p className='analysis-disclaimer'>Analysis only — no trades are executed.</p>
    </section>;
};

export default Analysis;
