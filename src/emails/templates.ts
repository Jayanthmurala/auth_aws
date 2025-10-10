export function verifyEmailMjml(params: { appName: string; actionUrl: string; supportEmail?: string }) {
  const { appName, actionUrl, supportEmail } = params;
  return `
<mjml>
  <mj-head>
    <mj-preview>Verify your email to start using ${appName}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" color="#334155" />
      <mj-button background-color="#2563eb" color="#ffffff" font-weight="600" border-radius="10px" />
    </mj-attributes>
    <mj-style>
      .card { box-shadow: 0 10px 25px rgba(2,6,23,0.08); border-radius: 18px; }
      .brand { font-weight:800; letter-spacing:-0.02em; }
      .breakall { word-break: break-all; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f8fafc">
    <mj-section padding="24px 16px">
      <mj-column>
        <mj-text align="center" font-size="24px" font-weight="700" color="#0f172a" css-class="brand">
          ${appName}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section padding="0 16px 32px 16px">
      <mj-column css-class="card" background-color="#ffffff">
        <mj-section padding="0">
          <mj-column>
            <mj-image src="https://images.unsplash.com/photo-1527980965255-d3b416303d12?q=80&w=1200&auto=format&fit=crop" alt="Banner" fluid-on-mobile="true" border-radius="18px 18px 0 0" />
          </mj-column>
        </mj-section>
        <mj-spacer height="8px" />
        <mj-text align="center" font-size="20px" font-weight="700" color="#0f172a" padding-top="8px">Verify your email</mj-text>
        <mj-text align="center" color="#475569">You're almost there! Confirm your email address to finish setting up your account.</mj-text>
        <mj-button href="${actionUrl}" align="center" padding="8px 24px">Verify email</mj-button>
        <mj-text align="center" color="#64748b">This link will expire soon for your security.</mj-text>
        <mj-divider border-color="#f1f5f9" />
        <mj-text font-size="12px" color="#64748b">If the button above doesn't work, copy and paste this URL into your browser:</mj-text>
        <mj-text font-size="12px" color="#0f172a" css-class="breakall">${actionUrl}</mj-text>
        ${supportEmail ? `<mj-text font-size="12px" color="#64748b">Need help? Contact us at <a href="mailto:${supportEmail}">${supportEmail}</a>.</mj-text>` : ''}
        <mj-spacer height="8px" />
      </mj-column>
    </mj-section>

    <mj-section padding="0 16px 24px 16px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#94a3b8">© ${new Date().getFullYear()} ${appName}. All rights reserved.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

export function resetPasswordMjml(params: { appName: string; actionUrl: string; supportEmail?: string }) {
  const { appName, actionUrl, supportEmail } = params;
  return `
<mjml>
  <mj-head>
    <mj-preview>Reset your ${appName} password</mj-preview>
    <mj-attributes>
      <mj-all font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" color="#334155" />
      <mj-button background-color="#0ea5e9" color="#ffffff" font-weight="600" border-radius="10px" />
    </mj-attributes>
    <mj-style>
      .breakall { word-break: break-all; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f8fafc">
    <mj-section padding="24px 16px">
      <mj-column>
        <mj-text align="center" font-size="24px" font-weight="700" color="#0f172a">${appName}</mj-text>
      </mj-column>
    </mj-section>

    <mj-section padding="0 16px 32px 16px">
      <mj-column background-color="#ffffff" css-class="card">
        <mj-spacer height="8px" />
        <mj-text align="center" font-size="20px" font-weight="700" color="#0f172a">Reset your password</mj-text>
        <mj-text align="center" color="#475569">We received a request to reset your password. Click the button below to set a new one.</mj-text>
        <mj-button href="${actionUrl}" align="center" padding="8px 24px">Create new password</mj-button>
        <mj-text align="center" color="#64748b">If you did not request this, you can safely ignore this email.</mj-text>
        <mj-divider border-color="#f1f5f9" />
        <mj-text font-size="12px" color="#64748b">If the button above doesn't work, copy and paste this URL into your browser:</mj-text>
        <mj-text font-size="12px" color="#0f172a" css-class="breakall">${actionUrl}</mj-text>
        ${supportEmail ? `<mj-text font-size=\"12px\" color=\"#64748b\">Need help? Contact us at <a href=\"mailto:${supportEmail}\">${supportEmail}</a>.</mj-text>` : ''}
        <mj-spacer height="8px" />
      </mj-column>
    </mj-section>

    <mj-section padding="0 16px 24px 16px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#94a3b8">© ${new Date().getFullYear()} ${appName}. All rights reserved.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
