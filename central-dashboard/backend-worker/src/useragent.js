/**
 * Tiny User-Agent parser for the custom-tracked layer (no dependency).
 * /api/track parses the visitor's UA SERVER-SIDE and stores the result in
 * blob9=browser, blob10=os, blob11=device-type, so the Visitors/Sessions pages
 * can show "who/what visited" instead of only a random ID. Old rows (written
 * before this field existed) simply show "—".
 *
 * Accuracy rule: when nothing matches we return generic values ("Other"/"Unknown")
 * - we never guess a specific brand.
 */

export function parseUserAgent(ua) {
  const s = String(ua || "");

  // ---- browser (order matters: Edge/Chrome-in-Edge & IE-in-Edge UA quirks) ----
  let browser = "Other";
  if (/OPR\/|Opera Mini/i.test(s)) browser = "Opera";
  else if (/Edg(A|IOS)?\//i.test(s)) browser = "Edge";
  else if (/SamsungBrowser\//i.test(s)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//i.test(s)) browser = "Firefox";
  else if (/MSIE |Trident\/|rv:11\.0/i.test(s)) browser = "Internet Explorer";
  else if (/Chrome\/|CriOS\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s)) browser = "Safari";

  // ---- OS ----
  let os = "Unknown";
  if (/Windows NT/i.test(s)) {
    const v = { "10.0": "10", "6.3": "8.1", "6.2": "8", "6.1": "7" }[(s.match(/Windows NT ([\d.]+)/i) || [])[1]];
    os = "Windows" + (v ? " " + v : "");
  } else if (/iPhone|iPad|iPod/i.test(s)) os = /iPad/i.test(s) ? "iPadOS" : "iOS";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";

  // ---- device type ----
  let device = "Desktop";
  if (/iPad/i.test(s)) device = "Tablet";
  else if (/Tablet|SM-T|GT-P|Nexus 7/i.test(s)) device = "Tablet";
  else if (/Mobi|iPhone|Android|iPad|iPod|Windows Phone/i.test(s)) device = "Mobile";

  return { browser, os, device };
}
