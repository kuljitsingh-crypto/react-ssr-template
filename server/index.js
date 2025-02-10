require("dotenv").config();
const express = require("express");
const enforceSsl = require("express-enforces-ssl");
const fs = require("fs");
const path = require("path");
const csp = require("./csp");
const { getExtractor, render, dataLoader } = require("./ssrUtills");
const { default: helmet } = require("helmet");
const CSP = process.env.REACT_APP_CSP;
const PORT = parseInt(process.env.PORT, 10);
const USING_SSL = process.env.REACT_APP_USING_SSL === "true";
const TRUST_PROXY = process.env.SERVER_TRUST_PROXY || null;

const buildPath = path.join(__dirname, "..", "build");
const staticPath = path.join(buildPath, "static");
const cspReportUri = "/csp-report";

const isCspEnabled = CSP === "block" || CSP === "report";

const errorPage = fs.readFileSync(path.join(buildPath, "500.html"), "utf8");

const app = express();

// The helmet middleware sets various HTTP headers to improve security.
// See: https://www.npmjs.com/package/helmet
// Helmet 4+ doesn't disable CSP by default so we need to do that explicitly.
// If csp is enabled we will add that separately.

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

if (isCspEnabled) {
  // When a CSP directive is violated, the browser posts a JSON body
  // to the defined report URL and we need to parse this body.
  app.use(
    express.json({
      type: ["json", "application/csp-report"],
      limit: "200mb",
    })
  );

  // CSP can be turned on in report or block mode. In report mode, the
  // browser checks the policy and calls the report URL when the
  // policy is violated, but doesn't block any requests. In block
  // mode, the browser also blocks the requests.

  // In Helmet 4+,supplying functions as directive values is not supported.
  // That's why we need to create own middleware function that calls the Helmet's middleware function
  const reportOnly = CSP === "report";
  app.use((req, res, next) => {
    csp(cspReportUri, reportOnly, USING_SSL)(req, res, next);
  });
}

// Set the TRUST_PROXY when running the app behind a reverse proxy.
//
// For example, when running the app in Heroku, set TRUST_PROXY to `true`.
//
// Read more: https://expressjs.com/en/guide/behind-proxies.html
//
if (TRUST_PROXY === "true") {
  app.enable("trust proxy");
} else if (TRUST_PROXY === "false") {
  app.disable("trust proxy");
} else if (TRUST_PROXY !== null) {
  app.set("trust proxy", TRUST_PROXY);
}

// Redirect HTTP to HTTPS if USING_SSL is `true`.
// This also works behind reverse proxies (load balancers) as they are for example used by Heroku.
// In such cases, however, the TRUST_PROXY parameter has to be set (see below)
//
// Read more: https://github.com/aredo/express-enforces-ssl
//
if (USING_SSL) {
  app.use(enforceSsl());
}

if (isCspEnabled) {
  // Dig out the value of the given CSP report key from the request body.
  const reportValue = (req, key) => {
    const report = req.body ? req.body["csp-report"] : null;
    return report && report[key] ? report[key] : key;
  };

  // Handler for CSP violation reports.
  app.post(cspReportUri, (req, res) => {
    const effectiveDirective = reportValue(req, "effective-directive");
    const blockedUri = reportValue(req, "blocked-uri");
    const msg = `CSP: ${effectiveDirective} doesn't allow ${blockedUri}`;
    //for now just showing in server console
    // but  will replace with @sentry/node in future version
    console.error(new Error(msg), "csp-violation");
    res.status(204).end();
  });
}

app.use("/static", express.static(staticPath));

const noCacheHeaders = {
  "Cache-control": "no-cache, no-store, must-revalidate",
};

app.get("*", async (req, res) => {
  try {
    if (req.url.startsWith("/static/")) {
      // The express.static middleware only handles static resources
      // that it finds, otherwise passes them through. However, we don't
      // want to render the app for missing static resources and can
      // just return 404 right away.
      return res.status(404).send("Static asset not found.");
    }

    if (req.url === "/_status.json") {
      return res.status(200).send({ status: "ok" });
    }

    // Until we have a better plan for caching dynamic content and we
    // make sure that no sensitive data can appear in the prefetched
    // data, let's disable response caching altogether.
    res.set(noCacheHeaders);
    const context = {};

    // Get chunk extractors from node and web builds
    // https://loadable-components.com/docs/api-loadable-server/#chunkextractor
    const { nodeExtractor, webExtractor } = getExtractor();

    // Server-side entrypoint provides us the functions for server-side data loading and rendering
    const nodeEntrypoint = nodeExtractor.requireEntrypoint();
    const {
      default: renderApp,
      routes,
      createStore,
      matchPathName,
    } = nodeEntrypoint;
    const data = await dataLoader(req.url, routes, matchPathName, createStore);
    const html = render(req, context, renderApp, webExtractor, data);

    if (context.url) {
      return res.redirect(context.url);
    }
    res.setHeader("Content-Type", "text/html");
    if (context.nofound) {
      return res.status(404).send(html);
    } else {
      return res.send(html);
    }
  } catch (err) {
    console.log(err);
    res.status(500).send(errorPage);
  }
});

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
