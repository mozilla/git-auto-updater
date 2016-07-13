
const ChildProcess = require('child_process');
const Fs = require('fs');
const Path = require('path');

var conf = {
  // Repository URI to clone from
  repository: null,

  // Branch to check out and update
  branch: 'master',

  // Path of repository
  path: null,

  // Frequency to check for updates, in minutes
  frequency: 1440,

  // Signal to send to command when performing update
  signal: 'SIGINT',

  // Command to run when not updating
  command: null,
};

// The spawned command process
var commandProcess = null;

function printUsage() {
  ['usage: git-auto-updater [options] [-- [command]]',
   '',
   'Periodically checks a git repository for updates and runs a command',
   'between updates.',
   '',
   'options:',
   '  -h, --help          print this message',
   '  -r, --repository    git repository URI',
   '  -b, --branch        git branch (Default: master)',
   '  -p, --path          local clone path (Default: repository name)',
   '  -f, --frequency     update check frequency, in minutes (Default: 1440)',
   '  -s, --signal        signal to terminate command (Default: SIGINT)',
   '  --                  stop processing command line arguments'].
    forEach(string => { console.log(string); });
}

function parseArguments() {
  var args = process.argv.splice(1);
  var buildingCommand = false;
  while (args.length) {
    var arg = args[0];
    args.shift();

    if (buildingCommand) {
      if (!conf.command) {
        conf.command = { name: arg, args: [] };
      } else {
        conf.command.args.push(arg);
      }
      continue;
    }

    switch(arg) {
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);

      case '-r':
      case '--repository':
        conf.repository = args[0];
        args.shift();
        break;

      case '-b':
      case '--branch':
        conf.branch = args[0];
        args.shift();
        break;

      case '-p':
      case '--path':
        conf.path = args[0];
        args.shift();
        break;

      case '-f':
      case '--frequency':
        conf.frequency = Number.parseInt(args[0]);
        args.shift();
        break;

      case '-s':
      case '--signal':
        conf.signal = args[0];
        args.shift();
        break;

      case '--':
        buildingCommand = true;
        break;
    }
  }
}

function validateConfiguration() {
  // If a path wasn't given but we have a repository URI, try to get the
  // path from that.
  if (!conf.path && conf.repository) {
    conf.path = Path.basename(conf.repository, '.git');
  }

  if (!conf.repository || !conf.path) {
    return false;
  }

  if (!Number.isInteger(conf.frequency) || conf.frequency < 1) {
    return false;
  }

  return true;
}

function startCommand() {
  if (conf.command) {
    commandProcess = ChildProcess.spawn(conf.command.name, conf.command.args,
      { stdio: 'inherit' }, () => { commandProcess = null; });
  }
}

function update() {
  if (commandProcess) {
    commandProcess.on('exit', () => {
      commandProcess = null;
      update();
    });
    commandProcess.kill(conf.signal);
    return;
  }

  ChildProcess.execFileSync('git', ['pull']);
  console.log('Updated.');
  startCommand();
}

function checkForUpdates() {
  console.log('Checking for update...');
  ChildProcess.execFileSync('git', ['fetch']);

  var currentRev = ChildProcess.execFileSync('git', ['rev-parse', 'HEAD']).
    toString().slice(0, 40);
  var latestRev = ChildProcess.execFileSync('git', ['rev-parse', 'HEAD@{u}']).
    toString().slice(0, 40);
  console.log('Current revision: ' + currentRev);
  console.log('Latest revision: ' + latestRev);

  if (currentRev != latestRev) {
    console.log('Updating...');
    update();
  }
}

parseArguments();

if (!validateConfiguration()) {
  console.log('Not enough or invalid arguments');
  printUsage();
  process.exit(1);
}

[`git-auto-updater starting with configuration:`,
 `repository: ${conf.repository}`,
 `branch: ${conf.branch}`,
 `path: ${conf.path}`,
 `update frequency: ${conf.frequency} minutes`].
  forEach(string => { console.log(string); });

if (conf.command) {
  var commandString = conf.command.name;
  conf.command.args.forEach(arg => { commandString += ` "${arg}"` });
  console.log(`command: ${commandString}`);
}

// Check if the path exists. If it doesn't, clone the repository, if it does,
// change into it and pull.
try {
  if (!Fs.statSync(conf.path).isDirectory()) {
    console.error('Path exists, but is not a directory. Aborting.');
    process.exit(1);
  }
  process.chdir(conf.path);
  ChildProcess.execFileSync('git', ['fetch']);
  try {
    ChildProcess.execFileSync('git', ['checkout', conf.branch]);
  } catch(e) {
    ChildProcess.execFileSync(
      'git', ['checkout', '-t', 'origin/' + conf.branch]);
  }
  ChildProcess.execFileSync('git', ['pull']);
} catch(e) {
  if (e.code !== 'ENOENT') {
    console.error('Encountered an error accessing path', e);
    process.exit(1);
  }

  ChildProcess.execFileSync(
      'git', ['clone', conf.repository, conf.path, '--branch', conf.branch]);
  process.chdir(conf.path);
}

// Spawn the child process, if one was given
startCommand();

// Set interval
setInterval(checkForUpdates, conf.frequency * 60 * 1000);
