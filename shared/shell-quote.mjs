// These commands are displayed for the existing assistant to run in its local shell.
export function shellQuote(value,platform=process.platform){
  return "'"+String(value).replaceAll("'",platform==='win32'?"''":"'\"'\"'")+"'";
}
