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
 * @fileoverview Classes for all frame events.
 */
'use strict';

goog.provide('Blockly.Events.FrameBase');
goog.provide('Blockly.Events.FrameChange');
goog.provide('Blockly.Events.FrameCreate');
goog.provide('Blockly.Events.FrameDelete');
goog.provide('Blockly.Events.FrameMove');

goog.require('Blockly.Events');
goog.require('Blockly.Events.Abstract');

goog.require('goog.math.Coordinate');


/**
 * Abstract class for a frame event.
 * @param {Blockly.Frame} frame The frame this event corresponds to.
 * @extends {Blockly.Events.Abstract}
 * @constructor
 */
Blockly.Events.FrameBase = function(frame) {
  /**
   * The ID of the frame this event pertains to.
   * @type {string}
   */
  this.frameId = frame.id;

  /**
   * The workspace identifier for this event.
   * @type {string}
   */
  this.workspaceId = frame.workspace.id;

  /**
   * The event group id for the group this event belongs to.
   * @type {string}
   */
  this.group = Blockly.Events.group_;

  /**
   * Sets whether the event should be added to the undo stack.
   * @type {boolean}
   */
  this.recordUndo = Blockly.Events.recordUndo;
};
goog.inherits(Blockly.Events.FrameBase, Blockly.Events.Abstract);

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.FrameBase.prototype.toJson = function() {
  var json = {
    'type': this.type
  };
  if (this.group) {
    json['group'] = this.group;
  }
  if (this.frameId) {
    json['frameId'] = this.frameId;
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.FrameBase.prototype.fromJson = function(json) {
  this.frameId = json['frameId'];
  this.group = json['group'];
};

/**
 * Helper function for finding the frame this event pertains to.
 * @return {?Blockly.Frame} The frame, or null if it no longer exists.
 * @private
 */
Blockly.Events.FrameBase.prototype.getFrame_ = function() {
  var workspace = this.getEventWorkspace_();
  return workspace.getFrameById(this.frameId);
};

/**
 * Class for a frame change event.
 * @param {Blockly.Frame} frame The frame that is being changed. Null for a
 *     blank event.
 * @param {!object} oldContents Object containing the previous state of the
 *     frame's properties. Possible properties are 'title', 'collapsed', or
 *     'width' and 'height' together.
 * @param {!object} newContents Object containing the new state of the frame's
 *     properties. Must contain the same properties as oldContents.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.FrameChange = function(frame, oldContents, newContents) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.FrameChange.superClass_.constructor.call(this, frame);
  this.oldContents_ = oldContents;
  this.newContents_ = newContents;
};
goog.inherits(Blockly.Events.FrameChange, Blockly.Events.FrameBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.FrameChange.prototype.type = Blockly.Events.FRAME_CHANGE;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.FrameChange.prototype.toJson = function() {
  var json = Blockly.Events.FrameChange.superClass_.toJson.call(this);
  json['newContents'] = this.newContents_;
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.FrameChange.prototype.fromJson = function(json) {
  Blockly.Events.FrameChange.superClass_.fromJson.call(this, json);
  this.newContents_ = json['newContents'];
};

/**
 * Does this event record any change of state?
 * @return {boolean} False if something changed.
 */
Blockly.Events.FrameChange.prototype.isNull = function() {
  return Blockly.Events.FrameChange.contentsEqual_(
      this.oldContents_, this.newContents_);
};

/**
 * Compare two frame content objects.
 * @param {object} a First contents object.
 * @param {object} b Second contents object.
 * @return {boolean} True if they describe the same state.
 * @private
 */
Blockly.Events.FrameChange.contentsEqual_ = function(a, b) {
  if (!a || !b) {
    return a == b;
  }
  var keys = Object.keys(a);
  if (keys.length != Object.keys(b).length) {
    return false;
  }
  for (var i = 0; i < keys.length; i++) {
    if (a[keys[i]] !== b[keys[i]]) {
      return false;
    }
  }
  return true;
};

/**
 * Run a change event.
 * @param {boolean} forward True if run forward, false if run backward (undo).
 */
Blockly.Events.FrameChange.prototype.run = function(forward) {
  var frame = this.getFrame_();
  if (!frame) {
    console.warn('Can\'t change non-existent frame: ' + this.frameId);
    return;
  }
  var contents = forward ? this.newContents_ : this.oldContents_;

  if (contents.hasOwnProperty('title')) {
    frame.setTitle(contents.title);
  }
  if (contents.hasOwnProperty('collapsed')) {
    frame.setCollapsed(contents.collapsed);
  }
  if (contents.hasOwnProperty('width') && contents.hasOwnProperty('height')) {
    frame.setSize(contents.width, contents.height);
  }
};

/**
 * Class for a frame creation event.
 * @param {Blockly.Frame} frame The created frame. Null for a blank event.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.FrameCreate = function(frame) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.FrameCreate.superClass_.constructor.call(this, frame);

  this.title = frame.getTitle();
  this.xy = frame.getXY();
  this.width = frame.getWidth();
  this.height = frame.getHeight();
  this.collapsed = frame.isCollapsed();
  this.blockIds = frame.getBlockIds();

  this.xml = frame.toXmlWithXY();
};
goog.inherits(Blockly.Events.FrameCreate, Blockly.Events.FrameBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.FrameCreate.prototype.type = Blockly.Events.FRAME_CREATE;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.FrameCreate.prototype.toJson = function() {
  var json = Blockly.Events.FrameCreate.superClass_.toJson.call(this);
  json['xml'] = Blockly.Xml.domToText(this.xml);
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.FrameCreate.prototype.fromJson = function(json) {
  Blockly.Events.FrameCreate.superClass_.fromJson.call(this, json);
  this.xml = Blockly.Xml.textToDom('<xml>' + json['xml'] + '</xml>').firstChild;
};

/**
 * Run a creation event.
 * @param {boolean} forward True if run forward, false if run backward (undo).
 */
Blockly.Events.FrameCreate.prototype.run = function(forward) {
  if (forward) {
    var workspace = this.getEventWorkspace_();
    var xml = goog.dom.createDom('xml');
    xml.appendChild(this.xml);
    Blockly.Xml.domToWorkspace(xml, workspace);
  } else {
    var frame = this.getFrame_();
    if (frame) {
      frame.dispose();
    } else {
      console.warn('Can\'t uncreate non-existent frame: ' + this.frameId);
    }
  }
};

/**
 * Class for a frame deletion event.
 * @param {Blockly.Frame} frame The deleted frame. Null for a blank event.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.FrameDelete = function(frame) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.FrameDelete.superClass_.constructor.call(this, frame);
  this.xml = frame.toXmlWithXY();
};
goog.inherits(Blockly.Events.FrameDelete, Blockly.Events.FrameBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.FrameDelete.prototype.type = Blockly.Events.FRAME_DELETE;

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.FrameDelete.prototype.toJson = function() {
  var json = Blockly.Events.FrameDelete.superClass_.toJson.call(this);
  json['xml'] = Blockly.Xml.domToText(this.xml);
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.FrameDelete.prototype.fromJson = function(json) {
  Blockly.Events.FrameDelete.superClass_.fromJson.call(this, json);
  this.xml = Blockly.Xml.textToDom('<xml>' + json['xml'] + '</xml>').firstChild;
};

/**
 * Run a deletion event.
 * @param {boolean} forward True if run forward, false if run backward (undo).
 */
Blockly.Events.FrameDelete.prototype.run = function(forward) {
  if (forward) {
    var frame = this.getFrame_();
    if (frame) {
      frame.dispose();
    } else {
      console.warn('Can\'t delete non-existent frame: ' + this.frameId);
    }
  } else {
    var workspace = this.getEventWorkspace_();
    var xml = goog.dom.createDom('xml');
    xml.appendChild(this.xml);
    Blockly.Xml.domToWorkspace(xml, workspace);
  }
};

/**
 * Class for a frame move event. Created before the move.
 * @param {Blockly.Frame} frame The frame that is being moved. Null for a blank
 *     event.
 * @extends {Blockly.Events.FrameBase}
 * @constructor
 */
Blockly.Events.FrameMove = function(frame) {
  if (!frame) {
    return;  // Blank event to be populated by fromJson.
  }
  Blockly.Events.FrameMove.superClass_.constructor.call(this, frame);

  /**
   * The frame that is being moved. Cleared after recording the new location.
   * @type {?Blockly.Frame}
   */
  this.frame_ = frame;

  this.workspaceWidth_ = frame.workspace.getWidth();

  /**
   * The location before the move, in workspace coordinates.
   * @type {!goog.math.Coordinate}
   */
  this.oldCoordinate_ = this.currentLocation_();

  /**
   * The location after the move, in workspace coordinates.
   * @type {!goog.math.Coordinate}
   */
  this.newCoordinate_ = null;
};
goog.inherits(Blockly.Events.FrameMove, Blockly.Events.FrameBase);

/**
 * Type of this event.
 * @type {string}
 */
Blockly.Events.FrameMove.prototype.type = Blockly.Events.FRAME_MOVE;

/**
 * Calculate the current, language agnostic location of the frame.
 * @return {goog.math.Coordinate} The location of the frame.
 * @private
 */
Blockly.Events.FrameMove.prototype.currentLocation_ = function() {
  var xy = this.frame_.getXY();
  if (!this.frame_.workspace.RTL) {
    return xy;
  }
  return new goog.math.Coordinate(this.workspaceWidth_ - xy.x, xy.y);
};

/**
 * Record the frame's new location. Called after the move. Can only be called
 * once.
 */
Blockly.Events.FrameMove.prototype.recordNew = function() {
  if (!this.frame_) {
    throw new Error('Tried to record the new position of a frame on the ' +
        'same event twice.');
  }
  this.newCoordinate_ = this.currentLocation_();
  this.frame_ = null;
};

/**
 * Override the location before the move. Use this if you don't create the
 * event until the end of the move, but you know the original location.
 * @param {!goog.math.Coordinate} xy The location before the move, in workspace
 *     coordinates.
 */
Blockly.Events.FrameMove.prototype.setOldCoordinate = function(xy) {
  this.oldCoordinate_ = new goog.math.Coordinate(this.frame_.workspace.RTL ?
      this.workspaceWidth_ - xy.x : xy.x, xy.y);
};

/**
 * Encode the event as JSON.
 * @return {!Object} JSON representation.
 */
Blockly.Events.FrameMove.prototype.toJson = function() {
  var json = Blockly.Events.FrameMove.superClass_.toJson.call(this);
  if (this.newCoordinate_) {
    json['newCoordinate'] = Math.round(this.newCoordinate_.x) + ',' +
        Math.round(this.newCoordinate_.y);
  }
  return json;
};

/**
 * Decode the JSON event.
 * @param {!Object} json JSON representation.
 */
Blockly.Events.FrameMove.prototype.fromJson = function(json) {
  Blockly.Events.FrameMove.superClass_.fromJson.call(this, json);

  if (json['newCoordinate']) {
    var xy = json['newCoordinate'].split(',');
    this.newCoordinate_ =
        new goog.math.Coordinate(parseFloat(xy[0]), parseFloat(xy[1]));
  }
};

/**
 * Does this event record any change of state?
 * @return {boolean} False if something changed.
 */
Blockly.Events.FrameMove.prototype.isNull = function() {
  return goog.math.Coordinate.equals(this.oldCoordinate_, this.newCoordinate_);
};

/**
 * Run a move event.
 * @param {boolean} forward True if run forward, false if run backward (undo).
 */
Blockly.Events.FrameMove.prototype.run = function(forward) {
  var frame = this.getFrame_();
  if (!frame) {
    console.warn('Can\'t move non-existent frame: ' + this.frameId);
    return;
  }

  var target = forward ? this.newCoordinate_ : this.oldCoordinate_;
  var current = frame.getXY();
  if (frame.workspace.RTL) {
    var deltaX = target.x - (this.workspaceWidth_ - current.x);
    frame.moveBy(-deltaX, target.y - current.y);
  } else {
    frame.moveBy(target.x - current.x, target.y - current.y);
  }
};
