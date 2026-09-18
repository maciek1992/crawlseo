import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-16">
      <div className="noise-overlay pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-2xl">
        <h1 className="font-heading text-atom-display1 font-semibold tracking-tight text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-2 text-atom-body text-muted-foreground">
          CrawlSEO · Last updated {new Date().toISOString().slice(0, 10)}
        </p>

        <div className="panel-elevated mt-8 space-y-6 p-8 text-atom-body text-foreground">
          <section>
            <h2 className="font-heading text-atom-title font-semibold text-foreground">
              What this is
            </h2>
            <p className="mt-2 text-muted-foreground">
              CrawlSEO is a self-hosted SEO tool. This instance is operated
              privately by its owner for their own use and is not offered as a
              public service. There is no public registration; access is
              limited to accounts explicitly authorized by the operator.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-atom-title font-semibold text-foreground">
              Data we access
            </h2>
            <p className="mt-2 text-muted-foreground">
              When you sign in with Google, this instance requests read-only
              access to Google Search Console data (
              <code className="text-atom-body-sm">
                webmasters.readonly
              </code>
              ) for sites you choose to connect, and basic profile
              information (name, email) to identify your account. If keyword
              planning features are enabled, read-only access to Google Ads
              keyword-idea data may also be requested, again strictly
              read-only — this instance never creates, modifies, or spends
              on any Google Ads or Search Console resource.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-atom-title font-semibold text-foreground">
              Where data lives
            </h2>
            <p className="mt-2 text-muted-foreground">
              All data is stored in a database run by the operator on their
              own server. Nothing is sold, shared, or transferred to third
              parties beyond the minimum necessary to call the Google APIs
              you explicitly authorize, and the optional third-party keyword
              data providers (Keyword Tool, DataForSEO) used only to fetch
              the keyword results you request.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-atom-title font-semibold text-foreground">
              Revoking access
            </h2>
            <p className="mt-2 text-muted-foreground">
              You can revoke this application&apos;s access at any time from
              your Google Account&apos;s{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="text-primary underline"
              >
                Security &gt; Third-party access
              </a>{" "}
              settings.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-atom-title font-semibold text-foreground">
              Contact
            </h2>
            <p className="mt-2 text-muted-foreground">
              Questions about this instance and its data handling can be
              directed to the operator at the contact address listed on the
              Google Cloud project associated with this application.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
