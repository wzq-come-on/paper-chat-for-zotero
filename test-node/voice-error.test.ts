import { strict as assert } from "node:assert";
import { runInNewContext } from "node:vm";
import { getVoiceErrorMessage } from "../src/utils/voiceError.ts";

describe("voice error display", function () {
  it("preserves Firefox worker rejection details instead of object Object", function () {
    assert.equal(
      getVoiceErrorMessage(
        { message: "File closed", errorCode: 4286185473 },
        "Speech failed",
      ),
      "File closed (code 4286185473)",
    );
  });

  it("reads errors created in a different JavaScript realm", function () {
    const error = runInNewContext('new Error("Native helper exited")');
    assert.equal(
      getVoiceErrorMessage(error, "Speech failed"),
      "Native helper exited",
    );
  });

  it("does not serialize arbitrary account or request data", function () {
    assert.equal(
      getVoiceErrorMessage(
        { authToken: "private", request: { key: "private" } },
        "Speech failed",
      ),
      "Speech failed",
    );
  });
});
