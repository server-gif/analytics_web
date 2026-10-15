# Tracking module - setup guide

## 1. Dataset banavo (ek j vaar, badha project mate common)

dash.cloudflare.com -> Workers & Pages -> Analytics Engine -> Create dataset
Naam: `site_activity`

## 2. Darek project ma 2 kaam karo

### a) wrangler.toml ma binding + PROJECT_NAME add karo

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "site_activity"

# Darek project mate ek unique naam. Je ek project/Worker multiple domains serve
# kare (Custom domains/Routes), to te badha domain automatic aa project niche
# group thay. Ex: project-a na Worker ne 3 domain attach hoy to 3 j "project-a" ma aavshe.
[vars]
PROJECT_NAME = "project-a"
```

### b) track.js file copy kari ne import karo

Worker na mukhya file (jem ke src/index.js) ma:

```js
import { trackEvent } from "./track.js";

export default {
  async fetch(request, env, ctx) {
    // Har page visit track karo
    trackEvent(env, request, "page_view");

    // ... tamaru existing code ...

    return new Response("...");
  }
}
```

## 3. Custom user actions track karva mate

Jya user koi specific kaam kare (click, video play, signup, etc.), tya `trackEvent` call karo:

```js
// Video play thay tyare
trackEvent(env, request, "video_play", { videoId: "abc123" });

// Signup thay tyare
trackEvent(env, request, "signup", { plan: "free" });

// Ad click thay tyare
trackEvent(env, request, "ad_click", { adUnit: "left-video" });
```

`actionName` (3rd argument) ma je pan naam aapo, e j dashboard ma "Activity" tarike group thai ne dekhashe.

## 4. Deploy

```
npx wrangler deploy
```

Badhu barobar thay to 5-10 minute ma data Analytics Engine ma aavva lagshe.
