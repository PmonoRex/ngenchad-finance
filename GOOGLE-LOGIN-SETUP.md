# Google login setup — เงินชัด

Frontend is implemented but disabled using `googleLoginEnabled: false` until provider setup is complete. Do not put the Google Client Secret in config.js, GitHub or chat.

1. In Google Cloud / Google Auth Platform, create or select a project, configure branding and the consent screen for เงินชัด. Choose External audience if users outside your organization will sign in. Configure only basic identity scopes (openid, email, profile); no Drive or Gmail access is needed. Follow the current console requirements.
2. Create an OAuth client of type Web application. Authorized JavaScript origin: `https://pmonorex.github.io`. Authorized redirect URI: `https://vcvpbqsvhoenztmmkfpz.supabase.co/auth/v1/callback`.
3. Enter Client ID and Client Secret directly in Supabase > Authentication > Sign In / Providers > Google. Enable the Google provider. The project owner must complete secret entry and approve enabling public registration.
4. Supabase Site URL and redirect allowlist must include `https://pmonorex.github.io/ngenchad-finance/`. Enable new user signup once the provider is configured and public registration is approved. Keep email confirmation enabled for password accounts.
5. Change only `googleLoginEnabled` to true, publish config.js, and verify with an external Google test account. Existing users remain supported. A new user should see the empty-account onboarding checklist. Verify logout and that two accounts cannot see each other’s data. Google testing mode restricts access to designated test users; use the production audience settings before inviting general users.

References:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls

Session 22 also adds a three-step onboarding checklist computed from real owned accounts, categories and active income/expenses. It waits until the data load succeeds and disappears automatically after completion. No finance records are created automatically. The default transaction date is reset after auth clears forms.
