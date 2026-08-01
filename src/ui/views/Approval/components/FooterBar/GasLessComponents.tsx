import React from 'react';
import styled from 'styled-components';

/**
 * Compatibility types for pre-Hippo approval state. Sponsored gas execution is
 * deliberately unavailable; these components render nothing.
 */
export type GasLessConfig = {
  theme_color?: string;
  dark_color?: string;
  [key: string]: unknown;
};

export function GasLessNotEnough(_props: Record<string, unknown>) {
  return null;
}

export function GasLessActivityToSign(_props: Record<string, unknown>) {
  return null;
}

export const GasLessAnimatedWrapper = styled.div``;

export function GasAccountTips(_props: Record<string, unknown>) {
  return null;
}
