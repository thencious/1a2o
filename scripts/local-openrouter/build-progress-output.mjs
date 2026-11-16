import {progressFromBuildLine} from "../../apps/web/utils/local-update/progress.mjs";

export function watchBuildOutput(stream, output, report) {
  let pending="";
  stream.setEncoding("utf8");
  const inspect=line=>{const next=progressFromBuildLine(line);if(next)report(next)};
  stream.on("data",chunk=>{
    output.write(chunk);
    const lines=(pending+chunk).split(/\r\n|\r|\n/);
    pending=lines.pop().slice(-8192);
    for(const line of lines)inspect(line);
  });
  stream.on("end",()=>{if(pending)inspect(pending)});
}
