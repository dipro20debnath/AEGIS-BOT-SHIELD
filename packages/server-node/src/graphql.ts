/**
 * Read-only GraphQL API over the same data as the REST status API
 * (routes.ts): stats, recent events, threat signals and configuration.
 *
 *   app.use(express.json());
 *   app.use('/aegis/graphql', aegisGraphQL(aegis));
 *
 *   POST /aegis/graphql  {"query": "{ stats { totalRequests blocked } events(verdict: block, limit: 5) { path score reasons } }"}
 *   GET  /aegis/graphql?query={stats{blocked}}
 *
 * There is no Mutation type, so nothing can be changed through it. Limits:
 * documents up to 8 KB, at most 10 root fields per operation (aliases count),
 * and `limit` arguments are capped at 500, so one request returns at most
 * 10 x 500 events. Like the REST status API it describes your traffic:
 * mount it behind authentication in production.
 */
import type { Request, Response } from 'express';
import {
  ASTVisitor, GraphQLBoolean, GraphQLEnumType, GraphQLError, GraphQLFloat, GraphQLInt, GraphQLList, GraphQLNonNull,
  GraphQLObjectType, GraphQLSchema, GraphQLString, Kind, NoSchemaIntrospectionCustomRule, ValidationContext,
  execute, parse, specifiedRules, validate, DocumentNode, OperationDefinitionNode, SelectionSetNode, GraphQLNullableType,
} from 'graphql';
import type { AegisNode } from './AegisNode.js';
import type { StatsEvent } from './stats.js';

export const MAX_DOCUMENT_BYTES = 8 * 1024;
export const MAX_ROOT_FIELDS = 10;
export const MAX_LIMIT = 500;

const nn = <T extends GraphQLNullableType>(t: T) => new GraphQLNonNull(t);
const list = <T extends GraphQLNullableType>(t: T) => nn(new GraphQLList(nn(t)));

const Verdict = new GraphQLEnumType({
  name: 'Verdict',
  values: { allow: {}, monitor: {}, challenge: {}, block: {} },
});

const ReasonCount = new GraphQLObjectType({
  name: 'ReasonCount',
  description: 'A detection signal and how many requests carried it',
  fields: { reason: { type: nn(GraphQLString) }, count: { type: nn(GraphQLInt) } },
});

const Event = new GraphQLObjectType({
  name: 'Event',
  description: 'One analysed request (the server keeps the most recent 500)',
  fields: {
    timestamp: { type: nn(GraphQLFloat), description: 'Unix time, ms' },
    path: { type: nn(GraphQLString) },
    verdict: { type: nn(Verdict) },
    score: { type: nn(GraphQLFloat), description: 'Risk score 0-100' },
    reasons: { type: list(GraphQLString), description: 'Signals that contributed to the score' },
    ipPrefix: { type: nn(GraphQLString), description: 'Client IP truncated to /24 (IPv4) or /48 (IPv6)', resolve: (e: StatsEvent) => e.ip },
    telemetry: { type: nn(GraphQLBoolean), description: 'True for SDK telemetry submissions' },
  },
});

const Stats = new GraphQLObjectType({
  name: 'Stats',
  description: 'Counters since the server process started',
  fields: {
    startedAt: { type: nn(GraphQLFloat) },
    uptimeSeconds: { type: nn(GraphQLInt) },
    totalRequests: { type: nn(GraphQLInt) },
    telemetrySubmissions: { type: nn(GraphQLInt) },
    allowed: { type: nn(GraphQLInt) },
    monitored: { type: nn(GraphQLInt) },
    challenged: { type: nn(GraphQLInt) },
    blocked: { type: nn(GraphQLInt) },
    topReasons: { type: list(ReasonCount) },
  },
});

const Thresholds = new GraphQLObjectType({
  name: 'Thresholds',
  fields: { block: { type: nn(GraphQLFloat) }, challenge: { type: nn(GraphQLFloat) } },
});

const Config = new GraphQLObjectType({
  name: 'Config',
  description: 'Non-secret configuration of the AEGIS middleware',
  fields: {
    mode: { type: nn(GraphQLString) },
    thresholds: { type: nn(Thresholds) },
    requireTokenPaths: { type: list(GraphQLString) },
    protectedPaths: { type: new GraphQLList(nn(GraphQLString)), description: 'null: every path not excluded' },
    excludedPaths: { type: list(GraphQLString) },
    tokenTtl: { type: nn(GraphQLInt) },
    mlEnabled: { type: nn(GraphQLBoolean) },
    sharedStore: { type: nn(GraphQLBoolean), description: 'True when state is shared through a store such as Redis' },
  },
});

const clampLimit = (limit: number) => Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

function denied(e: StatsEvent): boolean {
  return e.verdict === 'block' || e.verdict === 'challenge';
}

export function buildSchema(aegis: AegisNode): GraphQLSchema {
  const Query = new GraphQLObjectType({
    name: 'Query',
    fields: {
      health: {
        type: nn(new GraphQLObjectType({
          name: 'Health',
          fields: { status: { type: nn(GraphQLString) }, version: { type: nn(GraphQLString) }, timestamp: { type: nn(GraphQLFloat) } },
        })),
        resolve: () => ({ status: 'ok', version: '1.0.0', timestamp: Date.now() }),
      },
      stats: { type: nn(Stats), resolve: () => aegis.stats.summary() },
      events: {
        type: list(Event),
        description: `Most recent first. limit is capped at ${MAX_LIMIT}.`,
        args: {
          limit: { type: GraphQLInt, defaultValue: 100 },
          verdict: { type: Verdict },
          pathPrefix: { type: GraphQLString },
          minScore: { type: GraphQLFloat },
          signal: { type: GraphQLString, description: 'Only events whose reasons include this signal' },
        },
        resolve: (_: unknown, args: { limit: number; verdict?: string; pathPrefix?: string; minScore?: number; signal?: string }) =>
          aegis.stats.recent(MAX_LIMIT)
            .filter(e => (!args.verdict || e.verdict === args.verdict)
              && (!args.pathPrefix || e.path.startsWith(args.pathPrefix))
              && (args.minScore === undefined || args.minScore === null || e.score >= args.minScore)
              && (!args.signal || e.reasons.includes(args.signal)))
            .slice(0, clampLimit(args.limit)),
      },
      threats: {
        type: list(ReasonCount),
        description: 'Signals behind blocked or challenged requests in the recent window, most frequent first',
        args: { limit: { type: GraphQLInt, defaultValue: 10 } },
        resolve: (_: unknown, args: { limit: number }) => {
          const counts = new Map<string, number>();
          for (const e of aegis.stats.recent(MAX_LIMIT).filter(denied)) {
            for (const reason of e.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
          }
          return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, clampLimit(args.limit))
            .map(([reason, count]) => ({ reason, count }));
        },
      },
      config: {
        type: nn(Config),
        resolve: () => {
          const o = aegis.options;
          return {
            mode: o.mode, thresholds: o.thresholds, requireTokenPaths: o.requireTokenPaths,
            protectedPaths: o.protectedPaths ?? null, excludedPaths: o.excludedPaths, tokenTtl: o.tokenTtl,
            mlEnabled: !!o.mlUrl, sharedStore: !!o.store,
          };
        },
      },
    },
  });
  return new GraphQLSchema({ query: Query });
}

/** Counts root fields per operation, aliases and fragment spreads included. */
function rootFieldLimit(max: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map(context.getDocument().definitions
      .filter(d => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [(d as { name: { value: string } }).name.value, d]));
    const count = (set: SelectionSetNode, seen: Set<string>): number => set.selections.reduce((n, s) => {
      if (s.kind === Kind.FIELD) return n + 1;
      if (s.kind === Kind.INLINE_FRAGMENT) return n + count(s.selectionSet, seen);
      const name = s.name.value;
      const fragment = fragments.get(name) as { selectionSet: SelectionSetNode } | undefined;
      if (!fragment || seen.has(name)) return n;
      return n + count(fragment.selectionSet, new Set([...seen, name]));
    }, 0);
    return {
      OperationDefinition(node: OperationDefinitionNode) {
        if (count(node.selectionSet, new Set()) > max) {
          context.reportError(new GraphQLError(`At most ${max} root fields per operation`, { nodes: [node] }));
        }
      },
    };
  };
}

export interface GraphQLOptions {
  /** Allow schema introspection (default true; tools such as GraphiQL need it) */
  introspection?: boolean;
}

/** Express handler for GET and POST. Mount at the path you want, e.g. /aegis/graphql. */
export function aegisGraphQL(aegis: AegisNode, options: GraphQLOptions = {}) {
  const schema = buildSchema(aegis);
  const rules = [...specifiedRules, rootFieldLimit(MAX_ROOT_FIELDS),
    ...(options.introspection === false ? [NoSchemaIntrospectionCustomRule] : [])];

  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ errors: [{ message: 'Use GET or POST' }] });
      return;
    }
    const params = (req.method === 'GET' ? req.query : req.body ?? {}) as Record<string, unknown>;
    const query = params.query;
    if (typeof query !== 'string' || !query) {
      res.status(400).json({ errors: [{ message: 'Missing "query"' }] });
      return;
    }
    if (Buffer.byteLength(query) > MAX_DOCUMENT_BYTES) {
      res.status(413).json({ errors: [{ message: `Query larger than ${MAX_DOCUMENT_BYTES} bytes` }] });
      return;
    }
    let variables = params.variables as Record<string, unknown> | undefined;
    if (typeof variables === 'string') {
      try { variables = JSON.parse(variables); } catch { res.status(400).json({ errors: [{ message: 'variables is not JSON' }] }); return; }
    }

    let document: DocumentNode;
    try {
      document = parse(query, { maxTokens: 2000 });
    } catch (error) {
      res.status(400).json({ errors: [{ message: (error as Error).message }] });
      return;
    }
    const errors = validate(schema, document, rules);
    if (errors.length) {
      res.status(400).json({ errors: errors.map(e => ({ message: e.message })) });
      return;
    }
    const result = await execute({
      schema, document, variableValues: variables ?? undefined,
      operationName: typeof params.operationName === 'string' ? params.operationName : undefined,
    });
    res.status(result.errors && !result.data ? 400 : 200).json({
      data: result.data ?? null,
      ...(result.errors ? { errors: result.errors.map(e => ({ message: e.message, path: e.path })) } : {}),
    });
  };
}
