import React from "react";
import ReactDOMServer from "react-dom/server";
import { IntlProvider } from "react-intl";
import { BrowserRouter } from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import { HelmetProvider, HelmetServerState } from "react-helmet-async";
import { Provider } from "react-redux";
import { routes } from "./utill/routes";
import { RouteProvider as CustomRouteProvider } from "./components";
import { HttpContextProvider } from "./context";
import { StoreType, createStore } from "./store";
import { isEmpty } from "lodash";
import englishMesssages from "./translations/en.json";
import frenchMessages from "./translations/fr.json";
import spanishMessages from "./translations/es.json";
import germenMessages from "./translations/de.json";
import { localeOptions } from "./utill/localeHelper";
import moment from "moment";
import "./App.css";

type ServerAppPropTypes = {
  location: string;
  context: object;
  helmetContext: object;
  store: StoreType;
  isHydrated: boolean;
};

// If you want to add the language, imports  the wanted locale:
//   1) Create a translation messages file as "<language_code>.json" format under translations directory.
//   2) Import correct locale rules for Moment library
//   3) Use the `messagesInLocale` to add the correct translation messages in IntlProvider.
//   4) To support older browsers we need to  add the correct locale for intl-relativetimeformat to `util/polyfills.js`

// Note that there is also translations in './translations/countryCodes.js' file
// This file contains ISO 3166-1 alpha-2 country codes, country names and their translations in our default languages
// This will be used in collect billing address

// Step 2:
// If you are using a non-english locale with moment library,
// you should also import time specific formatting rules for that locale
// e.g. for French: import 'moment/locale/fr';

// Step 3:
// If you are using a non-english locale, point `messagesInLocale` to correct messages using localeOptions.<languageCode>
const messages = {
  [localeOptions.en]: englishMesssages,
  [localeOptions.fr]: frenchMessages,
  [localeOptions.de]: germenMessages,
  [localeOptions.es]: spanishMessages,
};

const setLocaleForMoment = (
  locale: (typeof localeOptions)[keyof typeof localeOptions] = localeOptions.en
) => {
  // Set the Moment locale globally
  // See: http://momentjs.com/docs/#/i18n/changing-locale/
  moment.locale(locale);
};

type ClientAppPropsType = {
  store: StoreType;
  isHydrated: boolean;
};

const ClientApp = (props: ClientAppPropsType) => {
  const { store, isHydrated } = props;
  const locale = localeOptions.en;
  const messagesInLocale = messages[locale];
  setLocaleForMoment(locale);
  return (
    <React.StrictMode>
      <IntlProvider
        locale={locale}
        messages={messagesInLocale}
        defaultLocale={localeOptions.en}>
        <Provider store={store}>
          <HelmetProvider>
            <BrowserRouter>
              <CustomRouteProvider
                routeConfiguration={routes}
                getState={store.getState}
                dispatch={store.dispatch}
                isHydrated={isHydrated}
              />
            </BrowserRouter>
          </HelmetProvider>
        </Provider>
      </IntlProvider>
    </React.StrictMode>
  );
};

const ServerApp = (props: ServerAppPropTypes) => {
  const { location, helmetContext, context, store, isHydrated } = props;
  const locale = localeOptions.en;
  const messagesInLocale = messages[locale];
  setLocaleForMoment(locale);

  return (
    <React.StrictMode>
      <IntlProvider
        locale={locale}
        messages={messagesInLocale}
        defaultLocale={localeOptions.en}>
        <Provider store={store}>
          <HttpContextProvider context={context}>
            <HelmetProvider context={helmetContext}>
              <StaticRouter location={location}>
                {" "}
                <CustomRouteProvider
                  routeConfiguration={routes}
                  dispatch={store.dispatch}
                  getState={store.getState}
                  isHydrated={isHydrated}
                />
              </StaticRouter>
            </HelmetProvider>
          </HttpContextProvider>
        </Provider>
      </IntlProvider>
    </React.StrictMode>
  );
};

type CollectChunksType = (element: React.JSX.Element) => React.ReactElement;

// This will be used to create element in server side
const renderApp = (
  location: string,
  context: object,
  collectChunks: CollectChunksType,
  preloadedStore: object
) => {
  const helmetContext: { helmet?: HelmetServerState } = {};
  const store = createStore(preloadedStore);
  const isHydrated = preloadedStore && !isEmpty(preloadedStore);

  // When rendering the app on server, we wrap the app with webExtractor.collectChunks
  // This is needed to figure out correct chunks/scripts to be included to server-rendered page.
  // https://loadable-components.com/docs/server-side-rendering/#3-setup-chunkextractor-server-side
  const withChunks = collectChunks(
    <ServerApp
      location={location}
      helmetContext={helmetContext}
      context={context}
      store={store}
      isHydrated={isHydrated}
    />
  );

  const html = ReactDOMServer.renderToString(withChunks);
  const { helmet: head } = helmetContext;
  return { head, body: html };
};

export { ClientApp, renderApp };
