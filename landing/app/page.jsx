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
          pls / v0.1
        </span>
        <span className="meta">an agent-native request library</span>
      </header>

      <h1 className="wordmark">pls.</h1>

      <p className="tagline">
        an <em>agent-native</em> request library.<br />
        collecting intelligence, in drips.
      </p>

      <p className="lede">
        agents make hundreds of http calls a day. pls catches each one, files it, and turns the
        ambient traffic into a collection you can replay.
      </p>

      <section className="cta" aria-label="install">
        <div className="cta-head">
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
          <span>~/ install pls</span>
          <span>⌘</span>
        </div>
        <pre>
          <span className="c"># 1. install the app</span>
          {'\n'}
          <span className="p">$ </span>git clone https://github.com/sunbeam/pls.git
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
          <a href="https://github.com/sunbeam/pls/releases">download for mac →</a>
          <a href="https://github.com/sunbeam/pls">view on github →</a>
        </div>
      </section>

      <section className="section">
        <h2>— the shift</h2>
        <p className="prose">
          api clients were built for a human at a keyboard, clicking <i>send</i>, eyeballing a
          response, and maybe — if they remembered — saving it into a folder.
        </p>
        <p className="prose">
          that's not the shape of the work anymore. the entity making the requests is an agent. it
          doesn't get tired, doesn't forget, and doesn't naturally save anything. the bottleneck
          isn't <i>typing the request</i>; it's <i>seeing what the agent just did</i> and{' '}
          <i>keeping the parts worth keeping</i>.
        </p>
        <p className="prose">
          pls is built around that shift. the agent fires the request through an mcp tool. pls
          renders it live in a window you can actually look at. anything interesting gets filed,
          tagged, and turned into a fixture you (or the next agent) can call again.
        </p>
      </section>

      <section className="section">
        <h2>— collecting intelligence in drips</h2>
        <p className="prose">
          one debugging session, you ask the agent to hit{' '}
          <code>POST /v1/checkouts</code> with three weird payloads. those three calls show up in
          pls. you star the one that reproduced the bug. it gets a name. it joins{' '}
          <i>checkouts / regressions</i>.
        </p>
        <p className="prose">
          a week later you're chasing a different bug. the agent reaches for the same endpoint —
          but this time it finds your fixture sitting there, with the exact headers and the exact
          body that broke things last time. it replays it. you skip an hour of guessing.
        </p>
        <p className="prose">
          that's the whole loop. <em>drip</em>, <em>file</em>, <em>recall</em>. the collection
          isn't something you sit down to author. it accrues, the way a good notes folder accrues
          — by being the path of least resistance.
        </p>
      </section>

      <section className="section">
        <h2>— what's in the box</h2>
        <ul className="bullets">
          <li>
            <b>mcp server.</b>
            <span>
              ships with pls. claude code, cursor, windsurf, codex — anything that speaks mcp can
              send through it.
            </span>
          </li>
          <li>
            <b>live request feed.</b>
            <span>
              every call the agent makes appears in real time. inspect headers, body, timing.
              replay with one keystroke.
            </span>
          </li>
          <li>
            <b>auto-collections.</b>
            <span>
              ad-hoc requests get filed under the host they hit. promote the good ones into named
              fixtures.
            </span>
          </li>
          <li>
            <b>local-first storage.</b>
            <span>
              everything is plain json on disk. version it, grep it, ship it in a pr alongside the
              code it tests.
            </span>
          </li>
          <li>
            <b>openapi aware.</b>
            <span>
              drop in a spec — pls turns it into a browsable collection your agent can call by
              name.
            </span>
          </li>
          <li>
            <b>secret refs.</b>
            <span>
              auth lives in profiles, resolved at send time. tokens never get baked into a saved
              request.
            </span>
          </li>
          <li>
            <b>tiny mac app.</b>
            <span>
              one window. keyboard-first. typography that respects your retina. opens in under a
              second.
            </span>
          </li>
          <li>
            <b>scriptable.</b>
            <span>
              the same store the app reads is exposed over mcp and over the cli. agents and humans
              share one source of truth.
            </span>
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
            <span>~/ a day with pls</span>
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

      <section className="section">
        <h2>— who it's for</h2>
        <p className="prose">
          people building with agents who've noticed the same thing: the agent is fine at making
          the request, and you are fine at reading the response, but the moment in between — where
          the request <i>is</i> — has no home. pls is the home.
        </p>
        <p className="prose">
          if you've ever asked claude to <code>curl</code> something, copied the result back into
          chat, and then ten minutes later wished you still had the request: this is for you.
        </p>
      </section>

      <section className="section cta-bottom">
        <h2>— get it</h2>
        <p className="prose">
          mac only for now. linux & windows builds are next. it's free. the source is on github,
          the issues are open, and the roadmap is whatever you tell us is broken.
        </p>
        <div className="links">
          <a href="https://github.com/sunbeam/pls/releases">↳ download for mac</a>
          <a href="https://github.com/sunbeam/pls">↳ source on github</a>
          <a href="https://github.com/sunbeam/pls#mcp-server">↳ mcp setup docs</a>
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
