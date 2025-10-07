#!/usr/bin/env node
import typegen from './typegen/typegen';

type Handler = (program: string, command: string, args: string[]) => Promise<void>;

const commands: Record<string, Handler> = {
  'generate-types': typegen
};

async function main(program: string, command: string, args: string[]) {
  if (command in commands) {
    await commands[command](program, command, args);
  } else {
    throw new Error(`${command ? `Unknown command \"${command}\"\n` : ``}Usage: ${program} ${Object.keys(commands).join(' | ')} [command args ... ]`);
  }
}

const [, program, command, ...args] = process.argv;

main(program.replace(/.*\//, ''), command, args).catch(err => {
  console.error(err.message);
  process.exit(1);
});