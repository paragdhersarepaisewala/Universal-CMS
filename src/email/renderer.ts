export interface RenderContext {
  [key: string]: unknown;
}

/**
 * Resolves a dot-notated path from a context object.
 * e.g. resolvePath({ user: { name: 'Alice' } }, 'user.name') => 'Alice'
 */
function resolvePath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const segments = path.trim().split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Replaces {{ variable.path }} expressions with values from context.
 */
export function renderTemplate(template: string, context: RenderContext): string {
  if (!template) return '';

  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, path) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Standard table-based HTML email shell with theme tokens.
 */
export function wrapInEmailLayout(bodyContent: string, options: {
  siteName?: string;
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  unsubscribeUrl?: string;
}): string {
  const siteName = options.siteName || 'Universal CMS';
  const primaryColor = options.primaryColor || '#0052cc';
  const backgroundColor = options.backgroundColor || '#f4f6f8';
  const textColor = options.textColor || '#172b4d';
  const unsubscribeFooter = options.unsubscribeUrl
    ? `<tr><td style="padding-top: 24px; font-size: 12px; color: #6b778c; text-align: center;">
         If you no longer wish to receive these marketing updates, you may <a href="${options.unsubscribeUrl}" style="color: ${primaryColor}; text-decoration: underline;">unsubscribe here</a>.
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: ${textColor}; line-height: 1.6;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: ${backgroundColor}; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${primaryColor}; padding: 24px 32px; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; letter-spacing: -0.2px;">${siteName}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #fafbfc; border-top: 1px solid #ebecf0; padding: 24px 32px; font-size: 13px; color: #6b778c; text-align: center;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="text-align: center;">
                    &copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.
                  </td>
                </tr>
                ${unsubscribeFooter}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
