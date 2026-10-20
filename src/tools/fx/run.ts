import { execute, parameters } from "./index";

function getArgument(name: string): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument?.split("=", 2)[1];
}

async function main() {
  const currency = getArgument("currency") ?? "USD";
  const days = Number(getArgument("days") ?? "30");
  const input = parameters.parse({ currency, days });
  const result = await execute(input);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
