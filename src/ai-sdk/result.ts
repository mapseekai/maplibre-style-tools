import {
  createStyleToolError,
  isStyleToolError,
} from '../core/index.js';
import type { StyleToolError } from '../core/index.js';

export type CommonResultFields<TData, TStyle> = {
  message: string;
  data?: TData;
  style?: TStyle;
};

export type CommonResultInput<TData = unknown, TStyle = unknown> =
  | (CommonResultFields<TData, TStyle> & { success: true })
  | (CommonResultFields<TData, TStyle> & { success: false; error: StyleToolError });

export type AiStyleToolResult<TData = unknown, TStyle = unknown> =
  CommonResultInput<TData, TStyle>;

export function toAiToolResult<TData, TStyle>(
  input: CommonResultInput<TData, TStyle>,
): AiStyleToolResult<TData, TStyle> {
  const fields: CommonResultFields<TData, TStyle> = {
    message: input.message,
    ...(input.data === undefined ? {} : { data: input.data }),
    ...(input.style === undefined ? {} : { style: input.style }),
  };

  if (input.success) return { success: true, ...fields };

  return {
    success: false,
    ...fields,
    error: isStyleToolError(input.error)
      ? input.error
      : createStyleToolError('INTERNAL', 'AI tool result contained an invalid error.'),
  };
}
