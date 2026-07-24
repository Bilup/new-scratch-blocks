/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2018 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Events fired as a result of UI actions in a Scratch-Blocks
 * editor that are not fired in Blockly.
 * @author fenichel@google.com (Rachel Fenichel)
 */
'use strict';

goog.provide('Blockly.Events.DragBlockOutside');
goog.provide('Blockly.Events.DragFrameOutside');
goog.provide('Blockly.Events.EndBlockDrag');
goog.provide('Blockly.Events.EndFrameDrag');

goog.require('Blockly.Events');
goog.require('Blockly.Events.BlockBase');
goog.require('Blockly.Events.FrameBase');

goog.require('goog.array');
goog.require('goog.math.Coordinate');

/**
 * Class for a block drag event. Fired when block dragged into or out of
 * the blocks UI.
 * @param {Blockly.Block} block The moved block.  Null for a blank event.
 * @extends {Blockly.Events.BlockBase}
 * @constructor
 */
Blockly.Events.DragBlockOutside = function(block) {
  if (!block) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.DragBlockOutside.superClass_.constructor.call(this, block);
  this.recordUndo = false;
};
goog.inherits(Blockly.Events.DragBlockOutside, Blockly.Events.BlockBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.DragBlockOutside.prototype.type = Blockly.Events.DRAG_OUTSIDE;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.DragBlockOutside.prototype.toJson = function() {
  var json = Blockly.Events.DragBlockOutside.superClass_.toJson.call(this);
  if (this.isOutside) {
    json['isOutside'] = this.isOutside;
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.DragBlockOutside.prototype.fromJson = function(json) {
  Blockly.Events.DragBlockOutside.superClass_.fromJson.call(this, json);
  this.isOutside = json['isOutside'];
};

/**
 * Class for a block end drag event.
 * @param {Blockly.Block} block The moved block.  Null for a blank event.
 * @param {boolean} isOutside True if the moved block is outside of the
 *     blocks workspace.
 * @extends {Blockly.Events.BlockBase}
 * @constructor
 */
Blockly.Events.EndBlockDrag = function(block, isOutside) {
  if (!block) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.EndBlockDrag.superClass_.constructor.call(this, block);
  this.isOutside = isOutside;
  // If drag ends outside the blocks workspace, send the block XML
  if (isOutside) {
    this.xml = Blockly.Xml.blockToDom(block, true /* opt_noId */);
  }
  this.recordUndo = false;
};
goog.inherits(Blockly.Events.EndBlockDrag, Blockly.Events.BlockBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.EndBlockDrag.prototype.type = Blockly.Events.END_DRAG;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.EndBlockDrag.prototype.toJson = function() {
  var json = Blockly.Events.EndBlockDrag.superClass_.toJson.call(this);
  if (this.isOutside) {
    json['isOutside'] = this.isOutside;
  }
  if (this.xml) {
    json['xml'] = this.xml;
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.EndBlockDrag.prototype.fromJson = function(json) {
  Blockly.Events.EndBlockDrag.superClass_.fromJson.call(this, json);
  this.isOutside = json['isOutside'];
  this.xml = json['xml'];
};

/**
 * Class for a frame drag event. Fired when a frame is dragged into or out of
 * the blocks UI, so that the rest of the editor can offer to take the drop.
 * @param {Blockly.Frame} frame The moved frame. Null for a blank event.
 * @param {boolean} isOutside True if the frame is outside of the blocks
 *     workspace.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.DragFrameOutside = function(frame, isOutside) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.DragFrameOutside.superClass_.constructor.call(this, frame);
  this.isOutside = isOutside;
  this.recordUndo = false;
};
goog.inherits(Blockly.Events.DragFrameOutside, Blockly.Events.FrameBase);

/**
 * Type of this event. The same type as a block being dragged outside: what
 * the editor does with it does not depend on which one it was.
 * @type {string}
 */
Blockly.Events.DragFrameOutside.prototype.type = Blockly.Events.DRAG_OUTSIDE;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.DragFrameOutside.prototype.toJson = function() {
  var json = Blockly.Events.DragFrameOutside.superClass_.toJson.call(this);
  if (this.isOutside) {
    json['isOutside'] = this.isOutside;
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.DragFrameOutside.prototype.fromJson = function(json) {
  Blockly.Events.DragFrameOutside.superClass_.fromJson.call(this, json);
  this.isOutside = json['isOutside'];
};

/**
 * Class for a frame end drag event. When the drag ends outside the workspace
 * the event carries the frame and the scripts inside it, which is everything
 * needed to recreate it on another sprite or in the backpack.
 * @param {Blockly.Frame} frame The moved frame. Null for a blank event.
 * @param {boolean} isOutside True if the frame was dropped outside of the
 *     blocks workspace.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.EndFrameDrag = function(frame, isOutside) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.EndFrameDrag.superClass_.constructor.call(this, frame);
  this.isOutside = isOutside;
  if (isOutside) {
    var xy = frame.getXY();
    // A frame that lands somewhere else always arrives expanded: which blocks
    // it owns is worked out from their positions, so there is no member list
    // to keep in step with the copies' new ids.
    this.frame = {
      title: frame.getTitle(),
      x: xy.x,
      y: xy.y,
      width: frame.getWidth(),
      height: frame.getHeight()
    };
    this.xml = goog.dom.createDom('xml');
    var members = frame.getMembers();
    for (var i = 0; i < members.length; i++) {
      // With XY: where each script sits relative to the frame is the only
      // record of which scripts the copy of the frame owns.
      this.xml.appendChild(Blockly.Xml.blockToDomWithXY(members[i], true));
    }
  }
  this.recordUndo = false;
};
goog.inherits(Blockly.Events.EndFrameDrag, Blockly.Events.FrameBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.EndFrameDrag.prototype.type = Blockly.Events.END_DRAG;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.EndFrameDrag.prototype.toJson = function() {
  var json = Blockly.Events.EndFrameDrag.superClass_.toJson.call(this);
  if (this.isOutside) {
    json['isOutside'] = this.isOutside;
  }
  if (this.frame) {
    json['frame'] = this.frame;
  }
  if (this.xml) {
    json['xml'] = this.xml;
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.EndFrameDrag.prototype.fromJson = function(json) {
  Blockly.Events.EndFrameDrag.superClass_.fromJson.call(this, json);
  this.isOutside = json['isOutside'];
  this.frame = json['frame'];
  this.xml = json['xml'];
};
