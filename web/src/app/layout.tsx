import './globals.css';
import Nav from '@/components/Nav';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Robinhood LP Radar</title>
      </head>
      <body>
        <div className="header">
          <div>
            <h1>🔭 Robinhood LP Radar</h1>
            <div className="status">Phase 4 — Full Pipeline</div>
          </div>
          <div><span className="status">Block: <span id="blockNum">--</span></span></div>
        </div>
        <Nav />
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
