// SigilMarkets/ui/chrome/AppFooter.tsx
"use client";

import React from "react";
import { APP_NAME, APP_VERSION, GITHUB_RELEASE_URL, GITHUB_REPO_URL } from "../../../config/buildInfo";
import "../../styles/appFooter.css";

export type AppFooterProps = Readonly<{
  className?: string;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

export const AppFooter = ({ className }: AppFooterProps) => {
  const hasVersion = APP_VERSION.trim().length > 0;
  const releaseUrl = hasVersion ? GITHUB_RELEASE_URL(APP_VERSION) : "";

  return (
    <footer className={cx("sm-app-footer", className)} aria-label="Build information">
      <div className="sm-app-footer__inner">
        <span className="sm-app-footer__text">
          {APP_NAME} v{APP_VERSION}
        </span>
        <span className="sm-app-footer__dot" aria-hidden="true">
          •
        </span>
        <a
          className="sm-app-footer__link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
        >
          GitHub
        </a>
        {hasVersion ? (
          <>
            <span className="sm-app-footer__dot" aria-hidden="true">
              •
            </span>
            <a
              className="sm-app-footer__link"
              href={releaseUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Release notes for v${APP_VERSION}`}
            >
              Release notes
            </a>
          </>
        ) : null}
      </div>
    </footer>
  );
};
