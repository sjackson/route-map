import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import fileExists from "./common";

export class RubyMethodCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const isControllerFile = document.fileName.endsWith("_controller.rb");
    if (!isControllerFile) {
      return codeLenses;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspacePath = workspaceFolder?.uri.fsPath;

    try {
      const controller = /app[\/\\]controllers[\/\\](.*?)_controller\.rb/.exec(
        document.fileName
      )![1];
      const routes = await this.getRoutes(workspacePath, controller);

      const promises = document
        .getText()
        .split("\n")
        .map(async (lineText, lineIndex) => {
          const match = /def\s+(\w+)/.exec(lineText);
          if (match) {
            const action = match[1];
            const route = findRouteForAction(routes, action, controller);
            if (route) {
              const codeLensRange = new vscode.Range(
                lineIndex,
                0,
                lineIndex,
                0
              );
              const codeLens = new vscode.CodeLens(codeLensRange);
              const codeLensVerb = new vscode.CodeLens(codeLensRange);
              const codeLensPath = new vscode.CodeLens(codeLensRange);
              const codeLensViewFile = new vscode.CodeLens(codeLensRange);
              const viewFilePath = await getViewFilePath(
                workspacePath!,
                route.controller,
                route.action
              );
              codeLens.command = {
                title: `${prefixEmoji(route.url)} ${route.url} `,
                command: "",
                tooltip: `PREFIX → ${route.url} REQUEST`
              };
              codeLensVerb.command = {
                title: `${route.verb}`,
                command: "",
                tooltip: `VERB → ${route.verb}`
              };
              codeLensPath.command = {
                title: `${route.refinedPattern}`,
                command: "",
                tooltip: `URL PATTERN → ${route.refinedPattern}`
              };
              codeLensViewFile.command = {
                title: `📤`,
                command: `extension.openView`,
                arguments: [viewFilePath],
                tooltip: `NAVIGATE TO VIEW → ${controller}#${action}`,
              };
              codeLenses.push(codeLens, codeLensPath);
              if (route.verb !== "") {
                codeLenses.push(codeLensVerb);
              }
              if (viewFilePath !== "") {
                codeLenses.push(codeLensViewFile);
              }
            }
          }
        });

      await Promise.all(promises);

      return codeLenses;
    } catch (error) {
      console.error(`Error running 'rails routes' command: ${error}`);
      vscode.window.showWarningMessage(
        "An error occurred while generating code lenses."
      );
      return [];
    }
  }

  private async getRoutes(
    workspacePath: string | undefined,
    controller: string
  ): Promise<Route[]> {
    try {
      const stdout = await runRailsRoutesCommand(workspacePath, controller);
      const routes = parseRoutes(stdout);
      return routes;
    } catch (error) {
      console.error(`Error parsing the route information: ${error}`);
      return [];
    }
  }
}

function runRailsRoutesCommand(
  workspacePath: string | undefined,
  controller: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const routeFilePath = path.join(
      workspacePath || "",
      "tmp",
      "routes_file.txt"
    );
    exec(
      `cat ${routeFilePath} | grep ${controller}#`,
      { cwd: workspacePath },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

function parseRoutes(routesOutput: string): Route[] {
  const routes: Route[] = [];
  const lines = routesOutput.split("\n");

  for (const line of lines) {
    const count = line.split(/\s+/).length;

    if (count === 5) {
      const [, verb, url, pattern, controllerAction] = line.split(/\s+/);
      const [controller, action] = controllerAction.split("#");
      const refinedPattern = pattern.split("(.:format)")[0];
      routes.push({ verb, url, refinedPattern, controller, action });
    } else if (count === 4) {
      const [, url, pattern, controllerAction] = line.split(/\s+/);
      const [controller, action] = controllerAction.split("#");
      const verb = "";
      const refinedPattern = pattern.split("(.:format)")[0];
      routes.push({ verb, url, refinedPattern, controller, action });
    }
  }
  return routes;
}

function findRouteForAction(
  routes: Route[],
  action: string,
  controller: string
): Route | undefined {
  return routes.find((route) => {
    const routeController = route.controller.toLowerCase();
    const routeAction = route.action.toLowerCase();
    const inputController = controller.toLowerCase();
    const inputAction = action.toLowerCase();

    return routeController === inputController && routeAction === inputAction;
  });
}

async function getViewFilePath(
  workspacePath: string,
  controller: string,
  action: string
): Promise<string> {
  const viewFilePath = path.join(
    workspacePath,
    "app",
    "views",
    controller,
    action
  );

  if (await fileExists(viewFilePath + ".html.haml")) {
    return viewFilePath + ".html.haml";
  } else if (await fileExists(viewFilePath + ".json.jbuilder")) {
    return viewFilePath + ".json.jbuilder";
  } else {
    return ``;
  }
}

function prefixEmoji(prefix: string) {
  const emojiMap: Record<string, string> = {
    "GET": '📬',
    "POST": '📮',
    "PATCH": '🩹',
    "PUT": '🔄',
    "DELETE": '🗑️',
  };
  return (emojiMap[prefix]as string) || '❓';
}

interface Route {
  verb: string;
  url: string;
  controller: string;
  action: string;
  refinedPattern: string;
}
