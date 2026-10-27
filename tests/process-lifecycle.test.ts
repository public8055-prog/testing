import {strict as assert} from "node:assert";
import {test} from "node:test";
import {childExitCode} from "../scripts/process-lifecycle.mjs";

test("process supervision distinguishes requested graceful termination from crashes and forced kills",()=>{
  for(const requested of [false,true]){
    assert.equal(childExitCode(0,null,requested),0);
    assert.equal(childExitCode(7,null,requested),7);
    for(const code of [130,143,137])assert.equal(childExitCode(code,null,requested),code);
    assert.equal(childExitCode(null,"SIGKILL",requested),1);
    assert.equal(childExitCode(null,"SIGSEGV",requested),1);
    assert.equal(childExitCode(null,null,requested),1);
  }
  for(const signal of ["SIGTERM","SIGINT"]){
    assert.equal(childExitCode(null,signal,true),0);
    assert.equal(childExitCode(null,signal,false),1);
  }
});
