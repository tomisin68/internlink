# SRS

Drop `InternLink_SRS_v1_1.md` in this folder.

The codebase is built against v1.1 and cites it throughout — requirement IDs
(`FR-104`, `FR-302`, `FR-404`…) appear in comments at the point where each one
is implemented, and the root `README.md` links here. The document itself was
supplied outside the repo, so it needs adding once.

Future revisions go alongside it as `InternLink_SRS_v1_2.md` and so on, rather
than overwriting — comments in the code reference requirement IDs, and those
only stay meaningful if the version they came from is still readable.

## Open questions carried over from §10.1

These were unresolved when this build started, and the code takes a position on
each. Revisit when the product owner answers:

- **Product name.** "InternLink" is used as the working title throughout —
  package names, the manifest, the logo mark. A rename touches
  `packages/*/package.json`, `apps/*/package.json`, `apps/web/vite.config.ts`
  (manifest), and the wordmark in `apps/web/src/components/ui/logo.tsx`.
- **Launch geography.** Assumed Nigeria: CAC verification, NGN default currency,
  `en-NG` manifest locale, and Nigeria-weighted skill suggestions in
  `apps/web/src/features/profile/constants.ts`.
- **FR-306 (recruiter team invites).** Treated as post-launch. The data model
  supports it — `RecruiterProfile.companyRole` is already `owner |
  hiring_manager | viewer`, and `listings.routes.ts` enforces it — but there is
  no invitation flow.
- **Ad sales process.** Assumed fully admin-managed, per §4.8. No self-serve
  advertiser surface exists; `AdUnit` is shaped so one can be added without a
  schema rewrite (FR-806).
