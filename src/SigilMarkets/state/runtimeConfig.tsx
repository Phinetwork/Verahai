// SigilMarkets/state/runtimeConfig.tsx
"use client";

import React, { createContext, useContext, useMemo } from "react";
import { defaultMarketApiConfig, type SigilMarketsMarketApiConfig } from "../api/marketApi";
import { defaultVaultApiConfig, type SigilMarketsVaultApiConfig } from "../api/vaultApi";
import { defaultPositionApiConfig, type SigilMarketsPositionApiConfig } from "../api/positionApi";
import { defaultOracleApiConfig, type SigilMarketsOracleApiConfig } from "../api/oracleApi";

export type SigilMarketsRuntimeConfig = Readonly<{
  marketApiConfig: SigilMarketsMarketApiConfig;
  vaultApiConfig: SigilMarketsVaultApiConfig;
  positionApiConfig: SigilMarketsPositionApiConfig;
  oracleApiConfig: SigilMarketsOracleApiConfig;
}>;

export type SigilMarketsRuntimeConfigProviderProps = Readonly<{
  children: React.ReactNode;
  marketApiConfig?: SigilMarketsMarketApiConfig;
  vaultApiConfig?: SigilMarketsVaultApiConfig;
  positionApiConfig?: SigilMarketsPositionApiConfig;
  oracleApiConfig?: SigilMarketsOracleApiConfig;
}>;

const SigilMarketsRuntimeConfigContext = createContext<SigilMarketsRuntimeConfig | null>(null);

export const SigilMarketsRuntimeConfigProvider = (props: SigilMarketsRuntimeConfigProviderProps) => {
  const value = useMemo<SigilMarketsRuntimeConfig>(() => {
    return {
      marketApiConfig: props.marketApiConfig ?? defaultMarketApiConfig(),
      vaultApiConfig: props.vaultApiConfig ?? defaultVaultApiConfig(),
      positionApiConfig: props.positionApiConfig ?? defaultPositionApiConfig(),
      oracleApiConfig: props.oracleApiConfig ?? defaultOracleApiConfig(),
    };
  }, [props.marketApiConfig, props.oracleApiConfig, props.positionApiConfig, props.vaultApiConfig]);

  return <SigilMarketsRuntimeConfigContext.Provider value={value}>{props.children}</SigilMarketsRuntimeConfigContext.Provider>;
};

export const useSigilMarketsRuntimeConfig = (): SigilMarketsRuntimeConfig => {
  const ctx = useContext(SigilMarketsRuntimeConfigContext);
  if (!ctx) throw new Error("useSigilMarketsRuntimeConfig must be used within <SigilMarketsRuntimeConfigProvider>");
  return ctx;
};
