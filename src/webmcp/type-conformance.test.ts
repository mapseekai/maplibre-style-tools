/// <reference types="webmcp-types" />

import type {
  WebMcpToolDefinitionLike,
} from './types.js';

type IsAssignable<From, To> = From extends To ? true : false;
const toolIsUpstreamCompatible:
  IsAssignable<WebMcpToolDefinitionLike, WebMCP.ModelContextTool> = true;
void toolIsUpstreamCompatible;
