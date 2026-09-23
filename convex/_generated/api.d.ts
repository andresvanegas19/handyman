/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as catalog from "../catalog.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as feedback from "../feedback.js";
import type * as firecrawl from "../firecrawl.js";
import type * as glb from "../glb.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib from "../lib.js";
import type * as mediaValidation from "../mediaValidation.js";
import type * as openrouter from "../openrouter.js";
import type * as problems from "../problems.js";
import type * as repairContracts from "../repairContracts.js";
import type * as repairGeometry from "../repairGeometry.js";
import type * as repairLifecycle from "../repairLifecycle.js";
import type * as repairModel from "../repairModel.js";
import type * as repairPipeline from "../repairPipeline.js";
import type * as repairRecommendations from "../repairRecommendations.js";
import type * as seed from "../seed.js";
import type * as tripo from "../tripo.js";
import type * as uploads from "../uploads.js";
import type * as validators from "../validators.js";
import type * as webm from "../webm.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  auth: typeof auth;
  catalog: typeof catalog;
  cleanup: typeof cleanup;
  crons: typeof crons;
  feedback: typeof feedback;
  firecrawl: typeof firecrawl;
  glb: typeof glb;
  http: typeof http;
  jobs: typeof jobs;
  lib: typeof lib;
  mediaValidation: typeof mediaValidation;
  openrouter: typeof openrouter;
  problems: typeof problems;
  repairContracts: typeof repairContracts;
  repairGeometry: typeof repairGeometry;
  repairLifecycle: typeof repairLifecycle;
  repairModel: typeof repairModel;
  repairPipeline: typeof repairPipeline;
  repairRecommendations: typeof repairRecommendations;
  seed: typeof seed;
  tripo: typeof tripo;
  uploads: typeof uploads;
  validators: typeof validators;
  webm: typeof webm;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
