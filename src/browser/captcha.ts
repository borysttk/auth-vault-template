import { Page } from "playwright";
import { getConfig } from "../config.js";
import { CaptchaResult, CaptchaSolution } from "../credentials/types.js";

const RECAPTCHA_IFRAME_SEL = 'iframe[src*="recaptcha"]';
const RECAPTCHA_BADGE_SEL = ".grecaptcha-badge";
const RECAPTCHA_V2_SEL = 'div[class*="g-recaptcha"]';
const HCAPTCHA_IFRAME_SEL = 'iframe[src*="hcaptcha"]';
const HCAPTCHA_BADGE_SEL = '.h-captcha';
const IMAGE_CAPTCHA_SEL = 'img[src*="captcha"], img[alt*="captcha"]';

function getSiteKeyFromSrc(src: string): string | null {
  const match = src.match(/[?&]k=([^&]+)/);
  return match ? match[1] : null;
}

export async function detectCaptcha(page: Page): Promise<CaptchaResult> {
  const url = page.url();

  try {
    // Check for reCAPTCHA v2 iframe
    const recaptchaIframe = await page.$(RECAPTCHA_IFRAME_SEL);
    if (recaptchaIframe) {
      const src = await recaptchaIframe.getAttribute("src");
      const extractedKey = await extractSiteKey(page);
      return {
        detected: true,
        captchaType: "recaptcha_v2",
        siteKey: src ? getSiteKeyFromSrc(src) ?? extractedKey : extractedKey,
        pageUrl: url,
        frameSelector: RECAPTCHA_IFRAME_SEL,
      };
    }

    // Check for reCAPTCHA badge (v2/v3)
    const badge = await page.$(RECAPTCHA_BADGE_SEL);
    if (badge) {
      const siteKey = await extractSiteKey(page);
      return {
        detected: true,
        captchaType: "recaptcha_v2",
        siteKey,
        pageUrl: url,
      };
    }

    // Check for reCAPTCHA v2 widget div
    const widget = await page.$(RECAPTCHA_V2_SEL);
    if (widget) {
      const dataSiteKey = await widget.getAttribute("data-sitekey");
      const extractedKey = await extractSiteKey(page);
      return {
        detected: true,
        captchaType: "recaptcha_v2",
        siteKey: dataSiteKey ?? extractedKey,
        pageUrl: url,
      };
    }

    // Check for hCaptcha
    const hcaptchaBadge = await page.$(HCAPTCHA_BADGE_SEL);
    if (hcaptchaBadge) {
      const dataSiteKey = await hcaptchaBadge.getAttribute("data-sitekey");
      return {
        detected: true,
        captchaType: "hcaptcha",
        siteKey: dataSiteKey || undefined,
        pageUrl: url,
      };
    }

    const hcaptchaIframe = await page.$(HCAPTCHA_IFRAME_SEL);
    if (hcaptchaIframe) {
      const src = await hcaptchaIframe.getAttribute("src");
      const siteKey = src ? getSiteKeyFromSrc(src) ?? undefined : undefined;
      return {
        detected: true,
        captchaType: "hcaptcha",
        siteKey,
        pageUrl: url,
        frameSelector: HCAPTCHA_IFRAME_SEL,
      };
    }

    // Check for image captcha
    const imageCaptcha = await page.$(IMAGE_CAPTCHA_SEL);
    if (imageCaptcha) {
      return {
        detected: true,
        captchaType: "image",
        pageUrl: url,
      };
    }

    // Check for text captcha (common patterns)
    const textCaptcha = await page.$('input[name*="captcha"], input[id*="captcha"], input[aria-label*="captcha"]');
    if (textCaptcha) {
      return {
        detected: true,
        captchaType: "text",
        pageUrl: url,
      };
    }
  } catch {
    // Ignore detection errors
  }

  return { detected: false, pageUrl: url };
}

async function extractSiteKey(page: Page): Promise<string | undefined> {
  try {
    const siteKey = await page.evaluate(() => {
      const recaptcha = (window as any).grecaptcha;
      if (recaptcha && recaptcha.render) {
        const widgets = document.querySelectorAll('.g-recaptcha');
        for (const w of widgets) {
          const key = w.getAttribute('data-sitekey');
          if (key) return key;
        }
      }
      return null;
    });
    return siteKey || undefined;
  } catch {
    return undefined;
  }
}

export async function solveCaptcha(
  captcha: CaptchaResult,
  apiKey?: string
): Promise<CaptchaSolution> {
  const cfg = getConfig();
  const key = apiKey || cfg.CAPTCHA_API_KEY;
  const service = cfg.CAPTCHA_SERVICE;

  if (!captcha.detected) {
    return { success: false, error: "No captcha detected" };
  }

  if (service === "none") {
    return { success: false, error: "Captcha solving is disabled (CAPTCHA_SERVICE=none)" };
  }

  if (!key) {
    return { success: false, error: "No CAPTCHA_API_KEY configured" };
  }

  switch (service) {
    case "2captcha":
      return solveVia2Captcha(captcha, key);
    case "capmonster":
      return { success: false, error: "CapMonster support coming soon" };
    default:
      return { success: false, error: `Unknown captcha service: ${service}` };
  }
}

async function solveVia2Captcha(
  captcha: CaptchaResult,
  apiKey: string
): Promise<CaptchaSolution> {
  const baseUrl = "https://2captcha.com";

  try {
    let method: string;
    let params: Record<string, string> = {
      key: apiKey,
      json: "1",
    };

    switch (captcha.captchaType) {
      case "recaptcha_v2":
        method = "userrecaptcha";
        params.method = method;
        if (captcha.siteKey) params.googlekey = captcha.siteKey;
        if (captcha.pageUrl) params.pageurl = captcha.pageUrl;
        break;
      case "recaptcha_v3":
        method = "userrecaptcha";
        params.method = method;
        params.version = "v3";
        if (captcha.siteKey) params.googlekey = captcha.siteKey;
        if (captcha.pageUrl) params.pageurl = captcha.pageUrl;
        break;
      case "hcaptcha":
        method = "hcaptcha";
        params.method = method;
        if (captcha.siteKey) params.sitekey = captcha.siteKey;
        if (captcha.pageUrl) params.pageurl = captcha.pageUrl;
        break;
      case "image":
        return { success: false, error: "Image captcha solving requires base64 image data" };
      case "text":
        return { success: false, error: "Text captcha solving requires screenshot" };
      default:
        return { success: false, error: `Unsupported captcha type: ${captcha.captchaType}` };
    }

    // Submit captcha
    const paramStr = new URLSearchParams(params).toString();
    const submitUrl = `${baseUrl}/in.php?${paramStr}`;
    const submitRes = await fetch(submitUrl);
    const submitData = await submitRes.json() as any;

    if (submitData.status !== 1) {
      return { success: false, error: `2captcha submit failed: ${submitData.request || "unknown"}` };
    }

    const captchaId = submitData.request as string;

    // Poll for result
    const pollParams = new URLSearchParams({
      key: apiKey,
      action: "get",
      id: captchaId,
      json: "1",
    }).toString();

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const pollRes = await fetch(`${baseUrl}/res.php?${pollParams}`);
      const pollData = await pollRes.json() as any;

      if (pollData.status === 1) {
        return {
          success: true,
          token: pollData.request as string,
        };
      }

      // CAPCHA_NOT_READY
      if (pollData.request !== "CAPCHA_NOT_READY") {
        return { success: false, error: `2captcha solve failed: ${pollData.request || "unknown"}` };
      }
    }

    return { success: false, error: "2captcha timeout after 5 minutes" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `2captcha error: ${msg}` };
  }
}

export async function applyRecaptchaSolution(
  page: Page,
  token: string
): Promise<void> {
  await page.evaluate((t: string) => {
    const recaptcha = (window as any).grecaptcha;
    if (recaptcha && recaptcha.getResponse) {
      const widgets = document.querySelectorAll('.g-recaptcha');
      widgets.forEach((w) => {
        const widgetId = w.getAttribute('data-recaptcha-widget-id');
        if (widgetId) {
          recaptcha.execute(parseInt(widgetId));
        }
      });
    }
    // Call the callback if grecaptcha callback is set
    const callback = (window as any).___grecaptcha_cfg?.clients?.[0]?.callback;
    if (typeof callback === "function") {
      callback(t);
    }
    // Try calling verifyCallback directly
    const verify = (window as any).verifyCallback;
    if (typeof verify === "function") {
      verify(t);
    }
  }, token);
}
