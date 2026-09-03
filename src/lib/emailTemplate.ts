/**
 * HTML email templates for Brujula.
 * Each function returns a ready-to-send HTML string with values interpolated.
 */

export function buildVerificationEmailHtml(verificationUrl: string): string {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Verifica tu correo - Brújula</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#111827; padding:28px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <div style="width:48px; height:48px; background-color:#6366f1; border-radius:50%; display:inline-block; text-align:center; line-height:48px; font-size:24px;">🧭</div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:12px;">
                    <span style="color:#ffffff; font-size:20px; font-weight:bold; letter-spacing:0.5px;">Brújula</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 24px 32px;">
              <h1 style="margin:0 0 16px 0; font-size:22px; color:#111827; text-align:center;">
                Verifica tu correo electrónico
              </h1>
              <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#4b5563; text-align:center;">
                ¡Gracias por unirte a <strong>Brújula</strong>! Confirma que esta dirección de correo te pertenece haciendo clic en el botón de abajo.
              </p>

              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding:12px 0 24px 0;">
                    <a href="${verificationUrl}"
                       style="background-color:#6366f1; color:#ffffff; text-decoration:none; font-size:15px; font-weight:bold; padding:14px 32px; border-radius:8px; display:inline-block;">
                      Verificar mi correo
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0; font-size:13px; line-height:1.6; color:#9ca3af; text-align:center;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin:0; font-size:13px; line-height:1.6; color:#6366f1; text-align:center; word-break:break-all;">
                ${verificationUrl}
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none; border-top:1px solid #e5e7eb; margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 32px 32px;">
              <p style="margin:0 0 8px 0; font-size:12px; line-height:1.6; color:#9ca3af; text-align:center;">
                Este enlace expirará en 24 horas. Si no creaste una cuenta en Brújula, puedes ignorar este correo.
              </p>
              <p style="margin:0; font-size:12px; color:#c1c5cb; text-align:center;">
                © ${year} Brújula. Todos los derechos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}