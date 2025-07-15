import { CommandResultCode } from "./CommandResultCode";
import { DecoratedRange } from "./DecoratedRange";

type CommandResultTextDecorations = CommandResultCode & {
  resultdata?: DecoratedRange[];
};

export { CommandResultTextDecorations };
