import os from "os";
import fs from "fs";
import path from "path";
import execa from "execa";

export class Monorepo {
  static tmpdir = os.tmpdir();
  static yarnCache = path.join(Monorepo.tmpdir, "yarn-cache-");

  root: string;

  get nodeModulesPath() {
    return path.join(this.root, "node_modules");
  }

  constructor(private name: string) {
    this.root = fs.mkdtempSync(
      path.join(Monorepo.tmpdir, `lage-monorepo-${name}-`)
    );
  }

  init() {
    execa.sync("git", ["init"], { cwd: this.root });
    this.generateRepoFiles();
  }

  install() {
    if (!fs.existsSync(this.nodeModulesPath)) {
      fs.mkdirSync(this.nodeModulesPath, { recursive: true });
    }

    // pretends to perform a npm install of lage
    fs.symlinkSync(
      path.join(this.nodeModulesPath, "lage"),
      path.join(__dirname, "..", ".."),
      "junction"
    );
  }

  /**
   * Simulates a "yarn" call by linking internal packages and generates a yarn.lock file
   */
  linkPackages() {
    const pkgs = fs.readdirSync(path.join(this.root, "packages"));

    if (!fs.existsSync(this.nodeModulesPath)) {
      fs.mkdirSync(this.nodeModulesPath, { recursive: true });
    }

    let yarnYaml = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1\n`;

    for (const pkg of pkgs) {
      fs.symlinkSync(
        path.join(this.root, "packages", pkg),
        path.join(this.nodeModulesPath, pkg),
        "junction"
      );

      const pkgJson = JSON.parse(
        fs.readFileSync(
          path.join(this.root, "packages", pkg, "package.json"),
          "utf-8"
        )
      );
      const deps = pkgJson.dependencies;

      yarnYaml += `"${pkg}@^${pkgJson.version}":\n  version "${pkgJson.version}"\n`;

      if (deps) {
        yarnYaml += `  dependencies:`;
        for (const dep of Object.keys(deps)) {
          yarnYaml += `    "${dep}" "0.1.0"`;
        }
      }
    }

    this.commitFiles({ "yarn.lock": yarnYaml });
  }

  generateRepoFiles() {
    this.commitFiles({
      "package.json": {
        name: this.name,
        version: "0.1.0",
        private: true,
        workspaces: ["packages/*"],
        scripts: {
          build: "lage build",
          test: "lage test",
          lint: "lage lint",
        },
        devDependencies: {
          lage: path.resolve(__dirname, "..", ".."),
        },
      },
      "lage.config.js": `module.exports = {
        pipeline: {
          build: ['^build'],
          test: ['build'],
          lint: []
        }
      };`,
    });

    this.commitFiles(
      {
        "node_modules/.bin/lage": `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;
esac

if [ -x "$basedir/node" ]; then
  "$basedir/node"  "$basedir/../lage/bin/lage.js" "$@"
  ret=$?
else
  node  "$basedir/../lage/bin/lage.js" "$@"
  ret=$?
fi
exit $ret`,
        "node_modules/.bin/lage.cmd": `@IF EXIST "%~dp0\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\..\\lage\\bin\\lage.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\..\\lage\\bin\\lage.js" %*
)`,
      },
      { executable: true }
    );
  }

  addPackage(name: string, internalDeps: string[] = []) {
    return this.commitFiles({
      [`packages/${name}/build.js`]: `console.log('building ${name}');`,
      [`packages/${name}/test.js`]: `console.log('building ${name}');`,
      [`packages/${name}/lint.js`]: `console.log('linting ${name}');`,
      [`packages/${name}/package.json`]: {
        name,
        version: "0.1.0",
        scripts: {
          build: "node ./build.js",
          test: "node ./test.js",
          lint: "node ./lint.js",
        },
        dependencies: {
          ...(internalDeps &&
            internalDeps.reduce((deps, dep) => {
              return { ...deps, [dep]: "*" };
            }, {})),
        },
      },
    });
  }

  clone(origin: string) {
    return execa.sync("git", ["clone", origin], { cwd: this.root });
  }

  push(origin: string, branch: string) {
    return execa.sync("git", ["push", origin, branch], { cwd: this.root });
  }

  commitFiles(
    files: { [name: string]: string | Object },
    options: { executable?: boolean } = {}
  ) {
    for (const [file, contents] of Object.entries(files)) {
      let out = "";
      if (typeof contents !== "string") {
        out = JSON.stringify(contents, null, 2);
      } else {
        out = contents;
      }

      const fullPath = path.join(this.root, file);

      if (!fs.existsSync(path.dirname(fullPath))) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      }

      fs.writeFileSync(fullPath, out);

      if (options.executable) {
        fs.chmodSync(
          path.join(this.root, file),
          fs.constants.S_IXUSR | fs.constants.S_IRUSR | fs.constants.S_IROTH
        );
      }
    }
    return execa.sync("git", ["add", ...Object.keys(files)], {
      cwd: this.root,
    });
  }

  run(command: string, args?: string[]) {
    return execa.sync("yarn", [command, ...(args || [])], {
      cwd: this.root,
    });
  }

  cleanup() {
    fs.rmdirSync(this.root, { recursive: true });
  }
}
