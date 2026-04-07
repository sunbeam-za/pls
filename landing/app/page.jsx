import Image from 'next/image'

export default function Page() {
  return (
    <main className="page">
      <header className="topbar">
        <span className="brand">
          <Image
            src="/sunbeam-logo.png"
            alt="sunbeam"
            width={22}
            height={22}
            className="brand-mark"
            priority
          />
          “pls” / v0.1
        </span>
        <span className="meta">an agent-native request library</span>
      </header>

      <h1 className="wordmark">“pls”</h1>

      <p className="tagline">
        an <em>agent-native</em> request library.<br />
        collecting intelligence, in drips.
      </p>

      <p className="lede">
        agents make hundreds of http calls a day. “pls” catches each one, files it, and turns the
        ambient traffic into a collection you can replay.
      </p>

      <section className="cta" aria-label="install">
        <div className="cta-head">
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
          <span>~/ install “pls”</span>
          <span>⌘</span>
        </div>
        <pre>
          <span className="c"># 1. install the app</span>
          {'\n'}
          <span className="p">$ </span>git clone https://github.com/sunbeam-za/pls.git
          {'\n'}
          <span className="p">$ </span>cd pls && npm install && npm run build:mac
          {'\n\n'}
          <span className="c"># 2. point your agent at it</span>
          {'\n'}
          <span className="p">$ </span>claude mcp add pls -- node ./out/mcp/pls-mcp.mjs
          {'\n\n'}
          <span className="c"># 3. tell the agent: route http through pls.</span>
          {'\n'}
          <span className="c"># that's it. open the app and watch it fill up.</span>
        </pre>
        <div className="cta-actions">
          <a href="https://github.com/sunbeam-za/pls/releases">download for mac →</a>
          <a href="https://github.com/sunbeam-za/pls">view on github →</a>
        </div>
      </section>

      <section className="section">
        <h2>— how it works</h2>
        <p className="prose">
          agent fires a request through “pls”. “pls” renders it live, files it under the right host,
          and lets you promote the good ones into named fixtures. next time the agent reaches for
          that endpoint, the fixture is already sitting there. <em>drip, file, recall.</em>
        </p>
      </section>

      <section className="section">
        <h2>— what's in the box</h2>
        <ul className="bullets">
          <li>
            <b>mcp server.</b>
            <span>claude, cursor, windsurf, codex — all send through “pls”.</span>
          </li>
          <li>
            <b>live feed.</b>
            <span>every call streams into one window. replay in a keystroke.</span>
          </li>
          <li>
            <b>auto-collections.</b>
            <span>ad-hoc calls get filed by host. promote the keepers.</span>
          </li>
          <li>
            <b>local-first.</b>
            <span>plain json on disk. version it, grep it, ship it in a pr.</span>
          </li>
          <li>
            <b>openapi aware.</b>
            <span>drop in a spec, get a browsable collection.</span>
          </li>
          <li>
            <b>secret refs.</b>
            <span>auth resolves at send time. tokens never get baked in.</span>
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>— a typical session</h2>
        <div className="cta">
          <div className="cta-head">
            <div className="dots">
              <span />
              <span />
              <span />
            </div>
            <span>~/ a day with “pls”</span>
            <span>⌘</span>
          </div>
          <pre>
            <span className="c">you</span>{' '}
            → "figure out why the webhook retries are 4xxing for tenant 91"
            {'\n\n'}
            <span className="c">agent</span>{' '}
            → calls pls.send_ad_hoc_request(GET /tenants/91/webhooks)
            {'\n'}
            {'         '}→ pls.send_ad_hoc_request(GET /webhooks/{'{id}'}/attempts)
            {'\n'}
            {'         '}→ pls.send_ad_hoc_request(POST /webhooks/{'{id}'}/replay)
            {'\n\n'}
            <span className="c">pls</span>{' '}
            → 3 requests appear in the window. you watch them stream.
            {'\n'}
            {'       '}you ⌘-click "save" on the replay call. name it{' '}
            <span className="p">webhook regression #91</span>.
            {'\n\n'}
            <span className="c">tomorrow</span>{' '}
            → "is the webhook regression still happening?"
            {'\n'}
            {'             '}agent → pls.send_saved_request(<span className="p">webhook regression #91</span>)
            {'\n'}
            {'             '}→ 200. fixed.
          </pre>
        </div>
      </section>

      <section className="section cta-bottom">
        <h2>— get it</h2>
        <p className="prose">mac only for now. free. open source.</p>
        <div className="links">
          <a href="https://github.com/sunbeam-za/pls/releases">↳ download for mac</a>
          <a href="https://github.com/sunbeam-za/pls">↳ source on github</a>
        </div>
      </section>

      <footer className="foot">
        <span>built so the http your agents make stops being throwaway.</span>
        <span className="brand">
          © 2026 —{' '}
          <Image
            src="/sunbeam-logo.png"
            alt="sunbeam"
            width={16}
            height={16}
            className="brand-mark sm"
          />
          sunbeam
        </span>
      </footer>
    </main>
  )
}
