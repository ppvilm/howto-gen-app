type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  pattern: string;
  handler: RouteHandler;
}

class DOMRouter {
  private routes: Route[] = [];
  private currentPath = '';

  constructor() {
    window.addEventListener('popstate', () => {
      this.handleRoute();
    });
  }

  addRoute(pattern: string, handler: RouteHandler) {
    this.routes.push({ pattern, handler });
  }

  private parsePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexPattern = pattern.replace(/:([^/]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });
    return {
      regex: new RegExp(`^${regexPattern}$`),
      paramNames
    };
  }

  private handleRoute() {
    const path = window.location.pathname;
    this.currentPath = path;

    for (const route of this.routes) {
      const { regex, paramNames } = this.parsePattern(route.pattern);
      const match = path.match(regex);
      
      if (match) {
        const params: Record<string, string> = {};
        paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        route.handler(params);
        return;
      }
    }

    this.navigate('/');
  }

  navigate(path: string) {
    if (path !== this.currentPath) {
      window.history.pushState({}, '', path);
      this.handleRoute();
    }
  }

  start() {
    this.handleRoute();
  }

  getCurrentPath(): string {
    return this.currentPath;
  }
}

export const router = new DOMRouter();