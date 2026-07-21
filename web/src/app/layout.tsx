import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Robinhood LP Radar</title>
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📡</text></svg>" />
      </head>
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="8" opacity="0.3" />
            <circle cx="12" cy="12" r="11" opacity="0.15" />
            <line x1="12" y1="12" x2="12" y2="1" />
            <line x1="12" y1="12" x2="12" y2="23" />
            <line x1="12" y1="12" x2="1" y2="12" />
            <line x1="12" y1="12" x2="23" y2="12" />
          </svg>
        </div>
        <div>
          <div className="header-title">ROBINHOOD LP RADAR</div>
          <div className="header-subtitle">Live Liquidity Intelligence</div>
        </div>
      </div>

      <div className="header-right">
        <div className="header-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="10" cy="10" r="7" />
            <line x1="21" y1="21" x2="15" y2="15" />
          </svg>
          <input type="text" placeholder="Search pool or token..." id="globalSearch" />
        </div>

        <div className="header-indicator">
          <span className="indicator-dot" />
          <span>Robinhood</span>
        </div>

        <button className="header-icon-btn" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>
    </header>
  );
}
