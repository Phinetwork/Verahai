// SigilMarkets/ui/chrome/AppFooter.tsx
"use client";

import { APP_NAME, APP_VERSION, GITHUB_REPO_URL } from "../../../config/buildInfo";
import "../../styles/appFooter.css";

export type AppFooterProps = Readonly<{
  className?: string;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

export const AppFooter = ({ className }: AppFooterProps) => {
  return (
    <footer className={cx("sm-app-footer", className)} aria-label="Build information">
      <div className="sm-app-footer__inner">
        <a
          className="sm-app-footer__link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${APP_NAME} v${APP_VERSION} on GitHub`}
        >
          <span className="sm-app-footer__text">
            {APP_NAME} v{APP_VERSION}
          </span>
        </a>
      </div>
    </footer>
  );
};
