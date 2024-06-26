import configs from "./configs";
import schema from "../admin-ita-schema.json";

const schemaCategories = [
  "api_keys",
  "content",
  "email",
  "advanced",
  "translations",
  "features",
  "rooms",
  "images",
  "theme",
  "links",
  "auth",
  "webrtc",
  "avatar"
];
const serviceNames = configs.CONFIGURABLE_SERVICES.split(",");
let currentAuthToken = null;

const setAuthToken = function (token) {
  currentAuthToken = token;
};

function getCategoryDisplayName(category) {
  switch (category) {
    case "api_keys":
      return "API Keys";
    case "content":
      return "Content";
    case "email":
      return "Email";
    case "advanced":
      return "Advanced";
    case "translations":
      return "Translations";
    case "features":
      return "Features";
    case "rooms":
      return "Rooms";
    case "images":
      return "Images";
    case "theme":
      return "Themes";
    case "links":
      return "Links";
    case "auth":
      return "Auth";
    case "webrtc":
      return "WebRTC";
    case "avatar":
      return "AVATAR";
    default:
      return null;
  }
}

function getCategoryDescription(category, provider) {
  switch (category) {
    case "api_keys":
      return "API keys for 3rd party services, used in media search and telemetry.";
    case "content":
      return "User-contributed content settings.";
    case "email":
      if (provider === "arbortect") {
        return "Custom SMTP email provider settings. Leave blank to use the SMTP settings you chose when configuring your server. Looking to customize magic link email? Go to App Settings > Auth";
      } else {
        return "Custom SMTP email provider settings. Leave blank to use your cloud provider's email service. Looking to customize magic link email? Go to App Settings > Auth";
      }
    case "advanced":
      return "Advanced Settings for those who know what they're doing.";
    case "translations":
      return "Text that you can change.";
    case "features":
      return "Features that you can toggle.";
    case "colors":
      return "Replace colors in the app.";
    case "links":
      return "Replace links in the app.";
    case "auth":
      return "Customize login email options.";
    case "webrtc":
      return "WebRTC Settings for those who know what they're doing.";
    default:
      return null;
  }
}

function getServiceDisplayName(service) {
  switch (service) {
    case "janus-gateway":
      return "Janus";
    case "reticulum":
      return "Reticulum";
    case "ita":
      return "Ita";
    default:
      return null;
  }
}

function getEndpoint(path) {
  if (configs.ITA_SERVER) {
    return `${configs.ITA_SERVER}/${path}`;
  } else {
    return `/api/ita/${path}`;
  }
}

function getRetEndpoint(path) {
  return `/api/v1/server_configs/${path}`;
  // if (configs.RETICULUM_SERVER) {
  //   return `${configs.RETICULUM_SERVER}/server_configs/${path}`;
  // } else {
  //   return `/api/server_configs/${path}`;
  // }
}

function fetchWithAuth(req) {
  const options = {};
  options.headers = new Headers();
  options.headers.set("Authorization", `Bearer ${currentAuthToken}`);
  options.headers.set("Content-Type", "application/json");
  return fetch(req, options);
}

function getSchemas() {
  return fetchWithAuth(getEndpoint("schemas"))
    .then(resp => resp.json())
    .catch(e => {
      if (e instanceof TypeError) {
        console.log("ita not available for getSchemas");
        return schema;
        // return fetchWithAuth(getRetEndpoint("schemas")).then(resp => resp.json());
      }
    });
}

function getAdminInfo() {
  return fetchWithAuth(getEndpoint("admin-info"))
    .then(resp => {
      if (resp.status === 200) return resp.json();
      else return { error: true, code: resp.status };
    })
    .catch(e => {
      if (e instanceof TypeError) {
        console.log("ita not available for getAdminInfo");
        return {};
        // return fetchWithAuth(getRetEndpoint("admin_info")).then(resp => resp.json());
      } else {
        console.error(e);
      }
    });
}

function getEditableConfig(service) {
  return fetchWithAuth(getEndpoint(`configs/${service}/ps`))
    .then(resp => {
      if (resp.status === 200) {
        resp.code = 200;
        return resp.json();
      } else return { error: true, code: resp.status };
    })
    .catch(e => {
      if (e instanceof TypeError && service == "reticulum") {
        console.log("ita not available for getEditableConfig");
        return fetchWithAuth(getRetEndpoint("editable_config"))
          .then(resp => resp.json())
          .catch(err => console.error(err));
      }
    });
}

function getConfig(service) {
  return fetchWithAuth(getEndpoint(`configs/${service}`))
    .then(resp => resp.json())
    .catch(e => {
      if (e instanceof TypeError && service == "reticulum") {
        console.log("ita not available for getConfig");
        return fetchWithAuth(getRetEndpoint("config")).then(resp => resp.json());
      }
    });
}

function putConfig(service, config) {
  const req = new Request(getEndpoint(`configs/${service}`), {
    method: "PATCH",
    body: JSON.stringify(config)
  });
  return fetchWithAuth(req)
    .then(resp => resp.json())
    .catch(e => {
      if (e instanceof TypeError && service == "reticulum") {
        const retReq = new Request(getRetEndpoint("config"), {
          method: "POST",
          body: JSON.stringify(config)
        });
        return fetchWithAuth(retReq)
          .then(resp => resp)
          .catch(err => console.log(err));
      }
    });
}

// An object is considered to be a config descriptor if it at least has
// a "type" key and has no keys which aren't valid descriptor metadata.
const DESCRIPTOR_FIELDS = [
  "default",
  "type",
  "of",
  "unmanaged",
  "category",
  "name",
  "description",
  "internal",
  "source",
  "deprecated",
  "choices"
];
function isDescriptor(obj) {
  if (typeof obj !== "object") return false;
  if (!("type" in obj)) return false;
  for (const k in obj) {
    if (!DESCRIPTOR_FIELDS.includes(k)) {
      return false;
    }
  }
  return true;
}

function getConfigValue(config, path) {
  let obj = config;
  for (const p of path) {
    if (p in obj && obj[p] !== undefined) {
      obj = obj[p]; // go down one level
    } else {
      obj = undefined; // the configuration for this value is empty; we can stop
      break;
    }
  }
  return obj;
}

function setConfigValue(config, path, val) {
  let obj = config;
  for (const p of path.slice(0, -1)) {
    if (p in obj && obj[p] !== undefined) {
      obj = obj[p]; // go down one level
    } else {
      obj = obj[p] = {}; // the configuration for this value is empty; keep creating new objects going down
    }
  }
  obj[path.slice(-1)] = val;
}

// Returns a map keyed by category that contains all the configs in that category.
const schemaByCategories = schema => {
  const o = {};

  for (const cat of schemaCategories) {
    o[cat] = JSON.parse(JSON.stringify(schema)); // Cheap copy

    // Remove nodes not belonging to category and clear empties
    const walk = n => {
      for (const x in n) {
        const v = n[x];
        if (isDescriptor(v)) {
          if (v.category !== cat) {
            delete n[x];
          }
        } else {
          walk(v);

          if (Object.keys(n[x]).length === 0) {
            delete n[x];
          }
        }
      }
    };

    walk(o[cat]);
  }

  return o;
};

export {
  schemaCategories,
  serviceNames,
  isDescriptor,
  getServiceDisplayName,
  getCategoryDisplayName,
  getCategoryDescription,
  getSchemas,
  getConfig,
  getEditableConfig,
  putConfig,
  getConfigValue,
  setConfigValue,
  setAuthToken,
  schemaByCategories,
  getAdminInfo
};
