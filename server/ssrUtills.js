const path = require("path");
const { ChunkExtractor } = require("@loadable/server");
const fs = require("fs");
const lodash = require("lodash");
const url = require("node:url");

const buildPath = path.join(__dirname, "..", "build");

// The HTML build file is generated from the `public/index.html` file
// and used as a template for server side rendering. The application
// head and body are injected to the template from the results of
// calling the `renderApp` function imported from the bundle above.
const indexHtml = fs.readFileSync(path.join(buildPath, "index.html"), "utf-8");

// This pattern matches the end of a line ($) immediately followed by the start of a line (^).
//Since no content can be both the end and the start of a line simultaneously,
//this effectively matches nothing.
const reNoMatch = /($^)/;

// Not all the Helmet provided data is tags to be added inside <head> or <body>
// <html> tag's attributes need separate interpolation functionality
const templatedWithHtmlAttributes = lodash.template(indexHtml, {
  // Replace htmlAttributes (Helmet data) in the HTML template with the following
  // syntax: data-htmlattr="variableName"
  //
  // This syntax is very intentional: it works as a data attribute and
  // doesn't render attributes that have special meaning in HTML renderig
  // (except containing some data).
  //
  // This special attribute should be added to <html> tag
  // It may contain attributes like lang, itemscope, and itemtype
  interpolate: /data-htmlattr=\"([\s|S]+?)\"/g,
  // Disable evaluated and escaped variables in the template
  escape: reNoMatch,
  evaluate: reNoMatch,
});

// Template tags inside given template string (templatedWithHtmlAttributes),
// which cantains <html> attributes already.
const templateTags = (indexHtmlWithHtmlAttributes) =>
  lodash.template(indexHtmlWithHtmlAttributes, {
    // Interpolate variables in the HTML template with the following
    // syntax: <!--!variableName-->
    //
    // This syntax is very intentional: it works as a HTML comment and
    // doesn't render anything visual in the dev mode, and in the
    // production mode, HtmlWebpackPlugin strips out comments using
    // HTMLMinifier except those that aren't explicitly marked as custom
    // comments. By default, custom comments are those that begin with a
    // ! character.
    //
    // Note that the variables are _not_ escaped since we only inject
    // HTML content.
    //
    // See:
    // - https://github.com/ampedandwired/html-webpack-plugin
    // - https://github.com/kangax/html-minifier
    // - Plugin options in the production Webpack configuration file
    interpolate: /<!--!([\s|\S]+?)-->/g,
    // Disable evaluated and escaped variables in the template
    // As we donot want to evaluate any javascript code during templating.
    evaluate: reNoMatch,
    escape: reNoMatch,
  });

// Interpolate htmlAttributes and other helmet data into the template
const template = (templateData) => {
  const htmlAttributes = templateData.htmlAttributes;
  const templateDataWithoutHtmlAttributes = lodash.omit(templateData, [
    "htmlAttributes",
  ]);
  const templateWithHtmlAttributes = templatedWithHtmlAttributes({
    htmlAttributes,
  });
  return templateTags(templateWithHtmlAttributes)(
    templateDataWithoutHtmlAttributes
  );
};

module.exports.render = (
  req,
  context,
  renderApp,
  webExtractor,
  preloadedState = {}
) => {
  // const fetchRequest = createFetchRequestForServer(req);
  //This is important as we don't want to set refernce for collectchunk to anything other than webExtractor.
  const collectWebChunk = webExtractor.collectChunks.bind(webExtractor);

  const data = renderApp(req.url, context, collectWebChunk, preloadedState);

  // if (!data) {
  //   return null;
  // }
  // Preloaded state needs to be passed for client side too.
  // For security reasons we ensure that preloaded state is considered as a string
  // by replacing '<' character with its unicode equivalent.
  // http://redux.js.org/docs/recipes/ServerRendering.html#security-considerations
  const serializeData = JSON.stringify(preloadedState).replace(/</g, "\\u003c");

  // At this point the serializedState is a string, the second
  // JSON.stringify wraps it within double quotes and escapes the
  // contents properly so the value can be injected in the script tag
  // as a string.
  const preloadedStateScript = `
      <script>window.__PRELOADED_STATE__ = ${JSON.stringify(
        serializeData
      )};</script>
  `;

  const { body, head } = data;

  const templateData = {
    body,
    htmlAttributes: head.htmlAttributes.toString(),
    links: head.link.toString(),
    meta: head.meta.toString(),
    title: head.title.toString(),
    script: head.script.toString(),
    ssrLinks: webExtractor.getLinkTags(),
    ssrStyles: webExtractor.getStyleTags(),
    ssrScript: webExtractor.getScriptTags(),
    preloadedStateScript,
  };
  return template(templateData);
};

module.exports.getExtractor = () => {
  const nodeStatsFile = path.resolve(buildPath, "node", "loadable-stats.json");
  const webStatsFile = path.resolve(buildPath, "loadable-stats.json");

  const nodeExtractor = new ChunkExtractor({ statsFile: nodeStatsFile });
  const webExtractor = new ChunkExtractor({ statsFile: webStatsFile });

  return { nodeExtractor, webExtractor };
};

module.exports.dataLoader = async (
  requestUrl,
  routes,
  matchPathName,
  createStore
) => {
  const { query, pathname } = url.parse(requestUrl);
  const queryMaybe = !!query && typeof query === "string" ? `?${query}` : "";
  const store = createStore();
  try {
    const matchedRoutes = matchPathName(pathname, routes);
    const promiseCalls = matchedRoutes.reduce((acc, matchedRoute) => {
      if (
        matchedRoute &&
        matchedRoute.route &&
        typeof matchedRoute.route.loadData === "function"
      ) {
        const { params } = matchedRoute;
        acc.push(
          matchedRoute.route.loadData(store.dispatch, params, queryMaybe)
        );
      }
      return acc;
    }, []);

    await Promise.all(promiseCalls);
    return store.getState();
  } catch (err) {
    console.error(err, "server side data loading failed");
    store.getState();
  }
};
