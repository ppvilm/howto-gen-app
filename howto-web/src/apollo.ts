import { ApolloClient, InMemoryCache, HttpLink, ApolloLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';

const httpUri = import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql';
const wsUri = import.meta.env.VITE_GRAPHQL_WS_URL || httpUri.replace(/^http/i, 'ws');

const httpLink = new HttpLink({ uri: httpUri });

const authLink = new ApolloLink((operation, forward) => {
  const token = localStorage.getItem('howto_token');
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  }));
  return forward(operation);
});

// WebSocket link for subscriptions
const wsLink = new GraphQLWsLink(createClient({
  url: wsUri,
  connectionParams: () => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('howto_token') : null;
    return token ? { headers: { authorization: `Bearer ${token}` } } : {};
  },
}));

// Route subscriptions to ws, others to http
const splitLink = split(
  ({ query }) => {
    const def = query.definitions.find((d: any) => d.kind === 'OperationDefinition');
    return !!(def && (def as any).operation === 'subscription');
  },
  wsLink,
  authLink.concat(httpLink),
);

export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
