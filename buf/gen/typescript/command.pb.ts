// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
// Source: command.proto
/* eslint-disable */

import type { ByteSource, PartialDeep } from "protoscript";
import * as protoscript from "protoscript";
import { JSONrequest, PBrequest } from "twirpscript";
// This is the minimum version supported by the current runtime.
// If this line fails typechecking, breaking changes have been introduced and this
// file needs to be regenerated by running `npx twirpscript`.
export { MIN_SUPPORTED_VERSION_0_0_56 } from "twirpscript";
import type { ClientConfiguration } from "twirpscript";
import * as common from "./common.pb";

//========================================//
//                 Types                  //
//========================================//

export interface Command {
  broadcasterId: string;
  command: string;
  type: string;
  typeValue: string;
}

export interface GetCommandsRequest {
  broadcasterId: string;
}

export interface GetCommandsResponse {
  status: common.ResponseStatus;
  commands: Command[];
}

export interface SetCommandResponse {
  status: common.ResponseStatus;
  command: Command;
}

//========================================//
//     CommandService Protobuf Client     //
//========================================//

export async function GetCommands(
  getCommandsRequest: GetCommandsRequest,
  config?: ClientConfiguration,
): Promise<GetCommandsResponse> {
  const response = await PBrequest(
    "/wolfyttv.event.CommandService/GetCommands",
    GetCommandsRequest.encode(getCommandsRequest),
    config,
  );
  return GetCommandsResponse.decode(response);
}

export async function SetCommand(
  command: Command,
  config?: ClientConfiguration,
): Promise<SetCommandResponse> {
  const response = await PBrequest(
    "/wolfyttv.event.CommandService/SetCommand",
    Command.encode(command),
    config,
  );
  return SetCommandResponse.decode(response);
}

//========================================//
//       CommandService JSON Client       //
//========================================//

export async function GetCommandsJSON(
  getCommandsRequest: GetCommandsRequest,
  config?: ClientConfiguration,
): Promise<GetCommandsResponse> {
  const response = await JSONrequest(
    "/wolfyttv.event.CommandService/GetCommands",
    GetCommandsRequestJSON.encode(getCommandsRequest),
    config,
  );
  return GetCommandsResponseJSON.decode(response);
}

export async function SetCommandJSON(
  command: Command,
  config?: ClientConfiguration,
): Promise<SetCommandResponse> {
  const response = await JSONrequest(
    "/wolfyttv.event.CommandService/SetCommand",
    CommandJSON.encode(command),
    config,
  );
  return SetCommandResponseJSON.decode(response);
}

//========================================//
//             CommandService             //
//========================================//

export interface CommandService<Context = unknown> {
  GetCommands: (
    getCommandsRequest: GetCommandsRequest,
    context: Context,
  ) => Promise<GetCommandsResponse> | GetCommandsResponse;
  SetCommand: (
    command: Command,
    context: Context,
  ) => Promise<SetCommandResponse> | SetCommandResponse;
}

export function createCommandService<Context>(
  service: CommandService<Context>,
) {
  return {
    name: "wolfyttv.event.CommandService",
    methods: {
      GetCommands: {
        name: "GetCommands",
        handler: service.GetCommands,
        input: { protobuf: GetCommandsRequest, json: GetCommandsRequestJSON },
        output: {
          protobuf: GetCommandsResponse,
          json: GetCommandsResponseJSON,
        },
      },
      SetCommand: {
        name: "SetCommand",
        handler: service.SetCommand,
        input: { protobuf: Command, json: CommandJSON },
        output: { protobuf: SetCommandResponse, json: SetCommandResponseJSON },
      },
    },
  } as const;
}

//========================================//
//        Protobuf Encode / Decode        //
//========================================//

export const Command = {
  /**
   * Serializes Command to protobuf.
   */
  encode: function (msg: PartialDeep<Command>): Uint8Array {
    return Command._writeMessage(
      msg,
      new protoscript.BinaryWriter(),
    ).getResultBuffer();
  },

  /**
   * Deserializes Command from protobuf.
   */
  decode: function (bytes: ByteSource): Command {
    return Command._readMessage(
      Command.initialize(),
      new protoscript.BinaryReader(bytes),
    );
  },

  /**
   * Initializes Command with all fields set to their default value.
   */
  initialize: function (msg?: Partial<Command>): Command {
    return {
      broadcasterId: "",
      command: "",
      type: "",
      typeValue: "",
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<Command>,
    writer: protoscript.BinaryWriter,
  ): protoscript.BinaryWriter {
    if (msg.broadcasterId) {
      writer.writeString(1, msg.broadcasterId);
    }
    if (msg.command) {
      writer.writeString(2, msg.command);
    }
    if (msg.type) {
      writer.writeString(3, msg.type);
    }
    if (msg.typeValue) {
      writer.writeString(4, msg.typeValue);
    }
    return writer;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: Command,
    reader: protoscript.BinaryReader,
  ): Command {
    while (reader.nextField()) {
      const field = reader.getFieldNumber();
      switch (field) {
        case 1: {
          msg.broadcasterId = reader.readString();
          break;
        }
        case 2: {
          msg.command = reader.readString();
          break;
        }
        case 3: {
          msg.type = reader.readString();
          break;
        }
        case 4: {
          msg.typeValue = reader.readString();
          break;
        }
        default: {
          reader.skipField();
          break;
        }
      }
    }
    return msg;
  },
};

export const GetCommandsRequest = {
  /**
   * Serializes GetCommandsRequest to protobuf.
   */
  encode: function (msg: PartialDeep<GetCommandsRequest>): Uint8Array {
    return GetCommandsRequest._writeMessage(
      msg,
      new protoscript.BinaryWriter(),
    ).getResultBuffer();
  },

  /**
   * Deserializes GetCommandsRequest from protobuf.
   */
  decode: function (bytes: ByteSource): GetCommandsRequest {
    return GetCommandsRequest._readMessage(
      GetCommandsRequest.initialize(),
      new protoscript.BinaryReader(bytes),
    );
  },

  /**
   * Initializes GetCommandsRequest with all fields set to their default value.
   */
  initialize: function (msg?: Partial<GetCommandsRequest>): GetCommandsRequest {
    return {
      broadcasterId: "",
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<GetCommandsRequest>,
    writer: protoscript.BinaryWriter,
  ): protoscript.BinaryWriter {
    if (msg.broadcasterId) {
      writer.writeString(1, msg.broadcasterId);
    }
    return writer;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: GetCommandsRequest,
    reader: protoscript.BinaryReader,
  ): GetCommandsRequest {
    while (reader.nextField()) {
      const field = reader.getFieldNumber();
      switch (field) {
        case 1: {
          msg.broadcasterId = reader.readString();
          break;
        }
        default: {
          reader.skipField();
          break;
        }
      }
    }
    return msg;
  },
};

export const GetCommandsResponse = {
  /**
   * Serializes GetCommandsResponse to protobuf.
   */
  encode: function (msg: PartialDeep<GetCommandsResponse>): Uint8Array {
    return GetCommandsResponse._writeMessage(
      msg,
      new protoscript.BinaryWriter(),
    ).getResultBuffer();
  },

  /**
   * Deserializes GetCommandsResponse from protobuf.
   */
  decode: function (bytes: ByteSource): GetCommandsResponse {
    return GetCommandsResponse._readMessage(
      GetCommandsResponse.initialize(),
      new protoscript.BinaryReader(bytes),
    );
  },

  /**
   * Initializes GetCommandsResponse with all fields set to their default value.
   */
  initialize: function (
    msg?: Partial<GetCommandsResponse>,
  ): GetCommandsResponse {
    return {
      status: common.ResponseStatus.initialize(),
      commands: [],
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<GetCommandsResponse>,
    writer: protoscript.BinaryWriter,
  ): protoscript.BinaryWriter {
    if (msg.status) {
      writer.writeMessage(1, msg.status, common.ResponseStatus._writeMessage);
    }
    if (msg.commands?.length) {
      writer.writeRepeatedMessage(
        2,
        msg.commands as any,
        Command._writeMessage,
      );
    }
    return writer;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: GetCommandsResponse,
    reader: protoscript.BinaryReader,
  ): GetCommandsResponse {
    while (reader.nextField()) {
      const field = reader.getFieldNumber();
      switch (field) {
        case 1: {
          reader.readMessage(msg.status, common.ResponseStatus._readMessage);
          break;
        }
        case 2: {
          const m = Command.initialize();
          reader.readMessage(m, Command._readMessage);
          msg.commands.push(m);
          break;
        }
        default: {
          reader.skipField();
          break;
        }
      }
    }
    return msg;
  },
};

export const SetCommandResponse = {
  /**
   * Serializes SetCommandResponse to protobuf.
   */
  encode: function (msg: PartialDeep<SetCommandResponse>): Uint8Array {
    return SetCommandResponse._writeMessage(
      msg,
      new protoscript.BinaryWriter(),
    ).getResultBuffer();
  },

  /**
   * Deserializes SetCommandResponse from protobuf.
   */
  decode: function (bytes: ByteSource): SetCommandResponse {
    return SetCommandResponse._readMessage(
      SetCommandResponse.initialize(),
      new protoscript.BinaryReader(bytes),
    );
  },

  /**
   * Initializes SetCommandResponse with all fields set to their default value.
   */
  initialize: function (msg?: Partial<SetCommandResponse>): SetCommandResponse {
    return {
      status: common.ResponseStatus.initialize(),
      command: Command.initialize(),
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<SetCommandResponse>,
    writer: protoscript.BinaryWriter,
  ): protoscript.BinaryWriter {
    if (msg.status) {
      writer.writeMessage(1, msg.status, common.ResponseStatus._writeMessage);
    }
    if (msg.command) {
      writer.writeMessage(2, msg.command, Command._writeMessage);
    }
    return writer;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: SetCommandResponse,
    reader: protoscript.BinaryReader,
  ): SetCommandResponse {
    while (reader.nextField()) {
      const field = reader.getFieldNumber();
      switch (field) {
        case 1: {
          reader.readMessage(msg.status, common.ResponseStatus._readMessage);
          break;
        }
        case 2: {
          reader.readMessage(msg.command, Command._readMessage);
          break;
        }
        default: {
          reader.skipField();
          break;
        }
      }
    }
    return msg;
  },
};

//========================================//
//          JSON Encode / Decode          //
//========================================//

export const CommandJSON = {
  /**
   * Serializes Command to JSON.
   */
  encode: function (msg: PartialDeep<Command>): string {
    return JSON.stringify(CommandJSON._writeMessage(msg));
  },

  /**
   * Deserializes Command from JSON.
   */
  decode: function (json: string): Command {
    return CommandJSON._readMessage(CommandJSON.initialize(), JSON.parse(json));
  },

  /**
   * Initializes Command with all fields set to their default value.
   */
  initialize: function (msg?: Partial<Command>): Command {
    return {
      broadcasterId: "",
      command: "",
      type: "",
      typeValue: "",
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (msg: PartialDeep<Command>): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    if (msg.broadcasterId) {
      json["broadcasterId"] = msg.broadcasterId;
    }
    if (msg.command) {
      json["command"] = msg.command;
    }
    if (msg.type) {
      json["type"] = msg.type;
    }
    if (msg.typeValue) {
      json["typeValue"] = msg.typeValue;
    }
    return json;
  },

  /**
   * @private
   */
  _readMessage: function (msg: Command, json: any): Command {
    const _broadcasterId_ = json["broadcasterId"] ?? json["broadcaster_id"];
    if (_broadcasterId_) {
      msg.broadcasterId = _broadcasterId_;
    }
    const _command_ = json["command"];
    if (_command_) {
      msg.command = _command_;
    }
    const _type_ = json["type"];
    if (_type_) {
      msg.type = _type_;
    }
    const _typeValue_ = json["typeValue"] ?? json["type_value"];
    if (_typeValue_) {
      msg.typeValue = _typeValue_;
    }
    return msg;
  },
};

export const GetCommandsRequestJSON = {
  /**
   * Serializes GetCommandsRequest to JSON.
   */
  encode: function (msg: PartialDeep<GetCommandsRequest>): string {
    return JSON.stringify(GetCommandsRequestJSON._writeMessage(msg));
  },

  /**
   * Deserializes GetCommandsRequest from JSON.
   */
  decode: function (json: string): GetCommandsRequest {
    return GetCommandsRequestJSON._readMessage(
      GetCommandsRequestJSON.initialize(),
      JSON.parse(json),
    );
  },

  /**
   * Initializes GetCommandsRequest with all fields set to their default value.
   */
  initialize: function (msg?: Partial<GetCommandsRequest>): GetCommandsRequest {
    return {
      broadcasterId: "",
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<GetCommandsRequest>,
  ): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    if (msg.broadcasterId) {
      json["broadcasterId"] = msg.broadcasterId;
    }
    return json;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: GetCommandsRequest,
    json: any,
  ): GetCommandsRequest {
    const _broadcasterId_ = json["broadcasterId"] ?? json["broadcaster_id"];
    if (_broadcasterId_) {
      msg.broadcasterId = _broadcasterId_;
    }
    return msg;
  },
};

export const GetCommandsResponseJSON = {
  /**
   * Serializes GetCommandsResponse to JSON.
   */
  encode: function (msg: PartialDeep<GetCommandsResponse>): string {
    return JSON.stringify(GetCommandsResponseJSON._writeMessage(msg));
  },

  /**
   * Deserializes GetCommandsResponse from JSON.
   */
  decode: function (json: string): GetCommandsResponse {
    return GetCommandsResponseJSON._readMessage(
      GetCommandsResponseJSON.initialize(),
      JSON.parse(json),
    );
  },

  /**
   * Initializes GetCommandsResponse with all fields set to their default value.
   */
  initialize: function (
    msg?: Partial<GetCommandsResponse>,
  ): GetCommandsResponse {
    return {
      status: common.ResponseStatusJSON.initialize(),
      commands: [],
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<GetCommandsResponse>,
  ): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    if (msg.status) {
      const _status_ = common.ResponseStatusJSON._writeMessage(msg.status);
      if (Object.keys(_status_).length > 0) {
        json["status"] = _status_;
      }
    }
    if (msg.commands?.length) {
      json["commands"] = msg.commands.map(CommandJSON._writeMessage);
    }
    return json;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: GetCommandsResponse,
    json: any,
  ): GetCommandsResponse {
    const _status_ = json["status"];
    if (_status_) {
      common.ResponseStatusJSON._readMessage(msg.status, _status_);
    }
    const _commands_ = json["commands"];
    if (_commands_) {
      for (const item of _commands_) {
        const m = CommandJSON.initialize();
        CommandJSON._readMessage(m, item);
        msg.commands.push(m);
      }
    }
    return msg;
  },
};

export const SetCommandResponseJSON = {
  /**
   * Serializes SetCommandResponse to JSON.
   */
  encode: function (msg: PartialDeep<SetCommandResponse>): string {
    return JSON.stringify(SetCommandResponseJSON._writeMessage(msg));
  },

  /**
   * Deserializes SetCommandResponse from JSON.
   */
  decode: function (json: string): SetCommandResponse {
    return SetCommandResponseJSON._readMessage(
      SetCommandResponseJSON.initialize(),
      JSON.parse(json),
    );
  },

  /**
   * Initializes SetCommandResponse with all fields set to their default value.
   */
  initialize: function (msg?: Partial<SetCommandResponse>): SetCommandResponse {
    return {
      status: common.ResponseStatusJSON.initialize(),
      command: CommandJSON.initialize(),
      ...msg,
    };
  },

  /**
   * @private
   */
  _writeMessage: function (
    msg: PartialDeep<SetCommandResponse>,
  ): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    if (msg.status) {
      const _status_ = common.ResponseStatusJSON._writeMessage(msg.status);
      if (Object.keys(_status_).length > 0) {
        json["status"] = _status_;
      }
    }
    if (msg.command) {
      const _command_ = CommandJSON._writeMessage(msg.command);
      if (Object.keys(_command_).length > 0) {
        json["command"] = _command_;
      }
    }
    return json;
  },

  /**
   * @private
   */
  _readMessage: function (
    msg: SetCommandResponse,
    json: any,
  ): SetCommandResponse {
    const _status_ = json["status"];
    if (_status_) {
      common.ResponseStatusJSON._readMessage(msg.status, _status_);
    }
    const _command_ = json["command"];
    if (_command_) {
      CommandJSON._readMessage(msg.command, _command_);
    }
    return msg;
  },
};
