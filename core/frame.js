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
 * @fileoverview A frame: a labelled, resizable, collapsible box that visually
 * groups the scripts sitting inside it. Frames are drawn and behave like
 * workspace comments, and share their styling.
 */
'use strict';

goog.provide('Blockly.Frame');

goog.require('Blockly.Events.FrameChange');
goog.require('Blockly.Events.FrameCreate');
goog.require('Blockly.Events.FrameDelete');
goog.require('Blockly.Events.FrameMove');
goog.require('Blockly.utils');

goog.require('goog.math.Coordinate');


/**
 * Class for a frame.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to put the frame on.
 * @param {!Object} opt_options Options: id, title, x, y, width, height,
 *     collapsed.
 * @constructor
 */
Blockly.Frame = function(workspace, opt_options) {
  var options = opt_options || {};

  /** @type {!Blockly.WorkspaceSvg} */
  this.workspace = workspace;

  /** @type {string} */
  this.id = options.id && !workspace.getFrameById(options.id) ?
      options.id : Blockly.utils.genUid();

  /**
   * Marks this as a frame for the gesture and dragging code, which duck-types
   * the things it can drag.
   * @type {boolean}
   */
  this.isFrame = true;

  this.title_ = options.title || '';
  this.collapsed_ = !!options.collapsed;

  /**
   * The blocks this frame swallowed when it was collapsed. Collapsing pulls
   * everything below the frame up into the space the frame used to occupy, so
   * while collapsed the frame can no longer work out which blocks are its own
   * from their positions alone, and has to remember them.
   * Only meaningful while collapsed_ is true.
   * @type {!Array.<string>}
   * @private
   */
  this.blockIds_ = options.blockIds || [];

  this.width_ = Math.max(options.width || Blockly.Frame.DEFAULT_WIDTH,
      Blockly.Frame.MIN_WIDTH);
  this.height_ = Math.max(options.height || Blockly.Frame.DEFAULT_HEIGHT,
      Blockly.Frame.MIN_HEIGHT);

  this.xy_ = new goog.math.Coordinate(options.x || 0, options.y || 0);

  /**
   * Blocks moving with this frame during a drag, and the move events recording
   * where they started. Null when not dragging.
   * @private
   */
  this.dragMembers_ = null;
  this.dragMemberEvents_ = null;
  this.lastDragXY_ = null;

  this.rendered_ = false;

  this.createDom_();
  this.workspace.addTopFrame(this);

  this.render();
  this.translate(this.xy_.x, this.xy_.y);
};

/** Default width of a new frame, in workspace units. */
Blockly.Frame.DEFAULT_WIDTH = 320;

/** Default height of a new frame, in workspace units. */
Blockly.Frame.DEFAULT_HEIGHT = 200;

/** Minimum width of a frame, in workspace units. Fits both title bar icons. */
Blockly.Frame.MIN_WIDTH = 100;

/** Minimum height of a frame, in workspace units. */
Blockly.Frame.MIN_HEIGHT = 54;

/** Height of the title bar, and of the whole frame when collapsed. */
Blockly.Frame.TOP_BAR_HEIGHT = 32;

/** Size of the square corner resize handle. */
Blockly.Frame.RESIZE_SIZE = 16;

/** Size of the icons in the title bar. */
Blockly.Frame.ICON_SIZE = 32;

/** Corner radius of the frame, matching a workspace comment. */
Blockly.Frame.BORDER_RADIUS = 4;

/** Gap left around the blocks inside a frame when it grows to fit them. */
Blockly.Frame.PADDING = 16;

/**
 * Create the frame's DOM, and put it behind every block on the workspace.
 * @private
 */
Blockly.Frame.prototype.createDom_ = function() {
  this.svgGroup_ = Blockly.utils.createSvgElement('g',
      {'class': 'blocklyFrame'}, null);

  this.svgRect_ = Blockly.utils.createSvgElement('rect',
      {
        'class': 'scratchCommentRect scratchWorkspaceCommentBorder',
        'x': 0,
        'y': 0,
        'rx': Blockly.Frame.BORDER_RADIUS,
        'ry': Blockly.Frame.BORDER_RADIUS
      },
      this.svgGroup_);

  this.svgTopBar_ = Blockly.utils.createSvgElement('rect',
      {
        'class': 'blocklyDraggable scratchCommentTopBar',
        'x': 0,
        'y': 0,
        'rx': 1,
        'ry': 1,
        'height': Blockly.Frame.TOP_BAR_HEIGHT
      },
      this.svgGroup_);

  this.collapseIcon_ = this.createIcon_();
  this.deleteIcon_ = this.createIcon_();
  this.setIconImage_(this.deleteIcon_, 'delete-x.svg');

  // The title is plain text so that the whole title bar stays draggable.
  // Double-clicking it, or the Rename context menu item, swaps in the input
  // below.
  this.titleText_ = Blockly.utils.createSvgElement('text',
      {
        'class': 'scratchCommentText blocklyFrameTitle',
        'x': Blockly.Frame.ICON_SIZE,
        'y': Blockly.Frame.TOP_BAR_HEIGHT / 2,
        'dominant-baseline': 'central'
      },
      this.svgGroup_);

  this.foreignObject_ = Blockly.utils.createSvgElement('foreignObject',
      {
        'class': 'blocklyFrameForeignObject',
        'x': Blockly.Frame.ICON_SIZE,
        'y': 0,
        'height': Blockly.Frame.TOP_BAR_HEIGHT,
        'display': 'none'
      },
      this.svgGroup_);
  var body = document.createElementNS(Blockly.HTML_NS, 'body');
  body.setAttribute('xmlns', Blockly.HTML_NS);
  body.className = 'blocklyMinimalBody';
  this.titleInput_ = document.createElementNS(Blockly.HTML_NS, 'input');
  this.titleInput_.className = 'blocklyFrameTitleInput scratchCommentText';
  this.titleInput_.setAttribute('dir', this.workspace.RTL ? 'RTL' : 'LTR');
  this.titleInput_.setAttribute('placeholder', Blockly.Msg.FRAME_DEFAULT_TITLE);
  body.appendChild(this.titleInput_);
  this.foreignObject_.appendChild(body);

  this.setTitleText_();

  this.resizeGroup_ = Blockly.utils.createSvgElement('g',
      {
        'class': this.workspace.RTL ?
            'scratchCommentResizeSW' : 'scratchCommentResizeSE'
      },
      this.svgGroup_);
  var resizeSize = Blockly.Frame.RESIZE_SIZE;
  Blockly.utils.createSvgElement('polygon',
      {'points': [0, resizeSize, resizeSize, resizeSize, resizeSize, 0].join(' ')},
      this.resizeGroup_);
  Blockly.utils.createSvgElement('line',
      {
        'class': 'blocklyResizeLine',
        'x1': resizeSize / 3, 'y1': resizeSize - 1,
        'x2': resizeSize - 1, 'y2': resizeSize / 3
      }, this.resizeGroup_);
  Blockly.utils.createSvgElement('line',
      {
        'class': 'blocklyResizeLine',
        'x1': resizeSize * 2 / 3, 'y1': resizeSize - 1,
        'x2': resizeSize - 1, 'y2': resizeSize * 2 / 3
      }, this.resizeGroup_);

  this.bringToFront();
};

/**
 * Move the frame in front of the other frames, but keep it behind every block.
 * Frames share the block canvas with the blocks and <g> tags have no z-index,
 * so this is a reorder of the canvas' children: all the frames sit at the
 * front of it, in stacking order, followed by the blocks.
 * @package
 */
Blockly.Frame.prototype.bringToFront = function() {
  var canvas = this.workspace.getCanvas();
  var children = canvas.childNodes;
  var firstBlock = null;
  for (var i = 0; i < children.length; i++) {
    if (!Blockly.utils.hasClass(children[i], 'blocklyFrame')) {
      firstBlock = children[i];
      break;
    }
  }
  canvas.insertBefore(this.svgGroup_, firstBlock);
};

/**
 * Add one of the title bar icons, using the same media as a workspace comment.
 * Both icons start on the left; setSize moves the delete icon over to the
 * right edge.
 * @return {!SVGElement} The icon's image element.
 * @private
 */
Blockly.Frame.prototype.createIcon_ = function() {
  return Blockly.utils.createSvgElement('image',
      {
        'class': 'blocklyFrameIcon',
        'x': 0,
        'y': (Blockly.Frame.TOP_BAR_HEIGHT - Blockly.Frame.ICON_SIZE) / 2,
        'width': Blockly.Frame.ICON_SIZE,
        'height': Blockly.Frame.ICON_SIZE
      },
      this.svgGroup_);
};

/**
 * Point a title bar icon at one of the media images.
 * @param {!SVGElement} icon The icon's image element.
 * @param {string} image The file name of the image, inside the media folder.
 * @private
 */
Blockly.Frame.prototype.setIconImage_ = function(icon, image) {
  icon.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
      this.workspace.options.pathToMedia + image);
};

/**
 * Show the frame's title, falling back to the placeholder when it has none.
 * @private
 */
Blockly.Frame.prototype.setTitleText_ = function() {
  this.titleText_.textContent = this.title_ || Blockly.Msg.FRAME_DEFAULT_TITLE;
  this.titleText_.setAttribute('fill-opacity', this.title_ ? 1 : 0.6);
};

/**
 * Turn the title into a text box so it can be typed into. The title is normally
 * plain text, so that dragging anywhere along the title bar moves the frame
 * instead of putting a cursor in a text box.
 * @package
 */
Blockly.Frame.prototype.startEditingTitle = function() {
  this.titleText_.setAttribute('display', 'none');
  this.foreignObject_.setAttribute('display', '');
  this.titleInput_.value = this.title_;
  this.titleInput_.focus();
  this.titleInput_.select();
};

/**
 * Put the title back to plain text, keeping whatever was typed.
 * @private
 */
Blockly.Frame.prototype.stopEditingTitle_ = function() {
  if (this.foreignObject_.getAttribute('display') == 'none') {
    return;
  }
  this.setTitle(this.titleInput_.value);
  this.foreignObject_.setAttribute('display', 'none');
  this.titleText_.setAttribute('display', '');
};

/**
 * Swap the collapse arrow between its open and closed images, the same way a
 * workspace comment does when it is minimized.
 * @private
 */
Blockly.Frame.prototype.updateCollapseIcon_ = function() {
  this.setIconImage_(this.collapseIcon_, this.collapsed_ ?
      'comment-arrow-up.svg' : 'comment-arrow-down.svg');
};

/**
 * Bind the frame's event handlers and draw it for the first time.
 * @package
 */
Blockly.Frame.prototype.render = function() {
  if (this.rendered_) {
    return;
  }
  this.rendered_ = true;

  if (!this.workspace.options.readOnly) {
    Blockly.bindEventWithChecks_(
        this.svgTopBar_, 'mousedown', this, this.pathMouseDown_);
    Blockly.bindEventWithChecks_(
        this.svgRect_, 'mousedown', this, this.pathMouseDown_);
    Blockly.bindEventWithChecks_(
        this.resizeGroup_, 'mousedown', this, this.resizeMouseDown_);

    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mousedown', this, this.iconMouseDown_, true);
    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mouseout', this, this.iconMouseOut_, true);
    Blockly.bindEventWithChecks_(
        this.collapseIcon_, 'mouseup', this, this.collapseMouseUp_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mousedown', this, this.iconMouseDown_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mouseout', this, this.iconMouseOut_, true);
    Blockly.bindEventWithChecks_(
        this.deleteIcon_, 'mouseup', this, this.deleteMouseUp_, true);

    // Double-clicking the title bar renames the frame. A single click has to
    // stay free to drag it.
    Blockly.bindEventWithChecks_(
        this.svgTopBar_, 'dblclick', this, this.titleDoubleClick_);

    // While the title is being typed into, the input owns the mouse.
    Blockly.bindEventWithChecks_(this.titleInput_, 'mousedown', this,
        function(e) {
          e.stopPropagation();
        }, true, true);
    Blockly.bindEventWithChecks_(
        this.titleInput_, 'blur', this, this.stopEditingTitle_);
    Blockly.bindEventWithChecks_(this.titleInput_, 'keydown', this,
        function(e) {
          if (e.keyCode == 13 || e.keyCode == 27) {
            if (e.keyCode == 27) {
              this.titleInput_.value = this.title_;
            }
            this.stopEditingTitle_();
          }
          e.stopPropagation();
        });
  }

  this.updateCollapseIcon_();
  this.setSize(this.width_, this.height_);
  if (this.collapsed_) {
    // The blocks this frame swallowed may not have been created yet, so
    // Blockly.Frame.onWorkspaceChange hides them as they arrive.
    this.setMembersVisible_(false);
  }
};

/**
 * Start renaming the frame when its title bar is double-clicked.
 * @param {!Event} e Double click event.
 * @private
 */
Blockly.Frame.prototype.titleDoubleClick_ = function(e) {
  this.startEditingTitle();
  e.stopPropagation();
};

/**
 * Lay the frame out at its current size.
 * @param {number} width Width of the frame when expanded.
 * @param {number} height Height of the frame when expanded.
 * @package
 */
Blockly.Frame.prototype.setSize = function(width, height) {
  width = Math.max(width, Blockly.Frame.MIN_WIDTH);
  height = Math.max(height, Blockly.Frame.MIN_HEIGHT);
  this.width_ = width;
  this.height_ = height;

  var drawnHeight = this.collapsed_ ? Blockly.Frame.TOP_BAR_HEIGHT : height;

  this.svgRect_.setAttribute('width', width);
  this.svgRect_.setAttribute('height', drawnHeight);
  this.svgTopBar_.setAttribute('width', width);

  var iconSize = Blockly.Frame.ICON_SIZE;
  // The delete icon hangs off the right edge, so it is the one thing that has
  // to be repositioned whenever the frame's width changes.
  this.deleteIcon_.setAttribute('x', width - iconSize);

  this.foreignObject_.setAttribute('width',
      Math.max(0, width - (2 * iconSize)));

  this.resizeGroup_.setAttribute('transform', 'translate(' +
      (width - Blockly.Frame.RESIZE_SIZE) + ',' +
      (drawnHeight - Blockly.Frame.RESIZE_SIZE) + ')');
  this.resizeGroup_.setAttribute('display', this.collapsed_ ? 'none' : '');
};

/**
 * @return {string} The frame's title.
 * @package
 */
Blockly.Frame.prototype.getTitle = function() {
  return this.title_;
};

/**
 * Set the frame's title.
 * @param {string} title The new title.
 * @package
 */
Blockly.Frame.prototype.setTitle = function(title) {
  if (this.title_ == title) {
    return;
  }
  Blockly.Events.fire(new Blockly.Events.FrameChange(
      this, {title: this.title_}, {title: title}));
  this.title_ = title;
  this.setTitleText_();
};

/**
 * @return {boolean} True if the frame is collapsed.
 * @package
 */
Blockly.Frame.prototype.isCollapsed = function() {
  return this.collapsed_;
};

/**
 * @return {!Array.<string>} The ids of the blocks this frame swallowed when it
 *     was collapsed. Empty unless the frame is collapsed.
 * @package
 */
Blockly.Frame.prototype.getBlockIds = function() {
  return this.blockIds_;
};

/**
 * @return {number} The frame's width when expanded.
 * @package
 */
Blockly.Frame.prototype.getWidth = function() {
  return this.width_;
};

/**
 * @return {number} The frame's height when expanded.
 * @package
 */
Blockly.Frame.prototype.getHeight = function() {
  return this.height_;
};

/**
 * @return {!goog.math.Coordinate} The frame's position in workspace units.
 * @package
 */
Blockly.Frame.prototype.getXY = function() {
  return new goog.math.Coordinate(this.xy_.x, this.xy_.y);
};

/**
 * The same as getXY. Frames never move to the drag surface, so their position
 * is always just their translation.
 * @return {!goog.math.Coordinate} The frame's position in workspace units.
 * @package
 */
Blockly.Frame.prototype.getRelativeToSurfaceXY = function() {
  return this.getXY();
};

/**
 * Return the frame's bounding box, so that it takes part in workspace sizing
 * alongside blocks and comments.
 * @return {!{topLeft: goog.math.Coordinate, bottomRight: goog.math.Coordinate}}
 *     The frame's corners, in workspace coordinates.
 * @package
 */
Blockly.Frame.prototype.getBoundingRectangle = function() {
  var height = this.collapsed_ ? Blockly.Frame.TOP_BAR_HEIGHT : this.height_;
  return {
    topLeft: new goog.math.Coordinate(this.xy_.x, this.xy_.y),
    bottomRight: new goog.math.Coordinate(
        this.xy_.x + this.width_, this.xy_.y + height)
  };
};

/**
 * @return {!SVGElement} The frame's SVG group.
 * @package
 */
Blockly.Frame.prototype.getSvgRoot = function() {
  return this.svgGroup_;
};

/**
 * Move the frame by a relative offset, taking any blocks inside it along.
 * @param {number} dx Horizontal offset, in workspace units.
 * @param {number} dy Vertical offset, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveBy = function(dx, dy) {
  var event = new Blockly.Events.FrameMove(this);
  this.translate(this.xy_.x + dx, this.xy_.y + dy);
  event.recordNew();
  Blockly.Events.fire(event);
  this.workspace.resizeContents();
};

/**
 * Set the frame's translation.
 * @param {number} x The x coordinate, in workspace units.
 * @param {number} y The y coordinate, in workspace units.
 * @package
 */
Blockly.Frame.prototype.translate = function(x, y) {
  this.xy_ = new goog.math.Coordinate(x, y);
  this.svgGroup_.setAttribute('transform', 'translate(' + x + ',' + y + ')');
};

/**
 * Move the frame to an absolute position, taking any blocks inside it along.
 * @param {number} x The x coordinate, in workspace units.
 * @param {number} y The y coordinate, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveTo = function(x, y) {
  this.translate(x, y);
  this.dragMembersTo_(x, y);
};

/**
 * Move the frame during a drag. Frames stay on the block canvas so that they
 * keep painting behind the blocks, so there is never a drag surface to use.
 * @param {?Blockly.BlockDragSurfaceSvg} _dragSurface Unused.
 * @param {!goog.math.Coordinate} newLoc The new location, in workspace units.
 * @package
 */
Blockly.Frame.prototype.moveDuringDrag = function(_dragSurface, newLoc) {
  this.translate(newLoc.x, newLoc.y);
  this.dragMembersTo_(newLoc.x, newLoc.y);
};

/**
 * Drag the blocks inside the frame along with it. Called with the frame's
 * absolute position, and moves the members by however far the frame has moved
 * since last time, so that calling it twice with the same position is a no-op.
 * @param {number} x The frame's new x coordinate.
 * @param {number} y The frame's new y coordinate.
 * @private
 */
Blockly.Frame.prototype.dragMembersTo_ = function(x, y) {
  if (!this.dragMembers_ || !this.dragMembers_.length) {
    return;
  }
  var dx = x - this.lastDragXY_.x;
  var dy = y - this.lastDragXY_.y;
  if (!dx && !dy) {
    return;
  }
  this.lastDragXY_ = new goog.math.Coordinate(x, y);

  // The blocks' move events were captured when the drag started, and are fired
  // once when it ends, so keep the intermediate moves silent.
  Blockly.Events.disable();
  try {
    for (var i = 0; i < this.dragMembers_.length; i++) {
      this.dragMembers_[i].moveBy(dx, dy);
    }
  } finally {
    Blockly.Events.enable();
  }
};

/**
 * Add or remove the drag style, and snapshot the blocks that should travel
 * with the frame.
 * @param {boolean} adding True if the frame is being dragged.
 * @package
 */
Blockly.Frame.prototype.setDragging = function(adding) {
  if (adding) {
    this.bringToFront();
    this.dragMembers_ = this.getMembers();
    this.lastDragXY_ = this.getXY();
    this.dragMemberEvents_ = [];
    for (var i = 0; i < this.dragMembers_.length; i++) {
      // The move event's constructor records where the block started.
      this.dragMemberEvents_.push(
          new Blockly.Events.BlockMove(this.dragMembers_[i]));
    }
    Blockly.utils.addClass(this.svgGroup_, 'blocklyDragging');
  } else {
    if (this.dragMemberEvents_) {
      for (var j = 0; j < this.dragMemberEvents_.length; j++) {
        var event = this.dragMemberEvents_[j];
        event.recordNew();
        Blockly.Events.fire(event);
      }
    }
    this.dragMembers_ = null;
    this.dragMemberEvents_ = null;
    this.lastDragXY_ = null;
    Blockly.utils.removeClass(this.svgGroup_, 'blocklyDragging');
  }
};

/**
 * @return {boolean} True. Frames can be dropped on the toolbox or the trash
 *     can to delete them, like blocks and comments. The scripts travelling
 *     with the frame go with it.
 * @package
 */
Blockly.Frame.prototype.isDeletable = function() {
  return true;
};

/**
 * Update the cursor over the frame to show whether dropping it now would
 * delete it.
 * @param {boolean} enable True if the delete cursor should be shown.
 * @package
 */
Blockly.Frame.prototype.setDeleteStyle = function(enable) {
  if (enable) {
    Blockly.utils.addClass(this.svgGroup_, 'blocklyDraggingDelete');
  } else {
    Blockly.utils.removeClass(this.svgGroup_, 'blocklyDraggingDelete');
  }
};

/**
 * No-op, for compatibility with the bubble dragger.
 * @package
 */
Blockly.Frame.prototype.setAutoLayout = function() {
};

/**
 * @return {boolean} True. Frames can always be dragged.
 * @package
 */
Blockly.Frame.prototype.isMovable = function() {
  return true;
};

/**
 * Handle a mouse-down on the frame's body or title bar: start a drag.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.pathMouseDown_ = function(e) {
  var gesture = this.workspace.getGesture(e);
  if (gesture) {
    gesture.handleBubbleStart(e, this);
  }
};

/**
 * The blocks this frame owns. While the frame is collapsed this is the list it
 * recorded when it collapsed, because collapsing moved other scripts up into
 * the frame's footprint and made the positions unreliable. Otherwise it is
 * worked out from the positions.
 * @return {!Array.<!Blockly.BlockSvg>} The blocks inside this frame.
 * @package
 */
Blockly.Frame.prototype.getMembers = function() {
  if (!this.collapsed_) {
    return this.getContainedBlocks();
  }
  var blocks = [];
  for (var i = 0; i < this.blockIds_.length; i++) {
    var block = this.workspace.getBlockById(this.blockIds_[i]);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
};

/**
 * Find the top-level blocks sitting inside this frame. A block belongs to the
 * frame when the top left corner of its bounding box, which covers the whole
 * script stacked below it, lies within the frame's expanded rectangle. When
 * frames overlap, the smallest one that contains the block wins, so that a
 * frame inside another frame keeps its own scripts.
 * @return {!Array.<!Blockly.BlockSvg>} The blocks inside this frame.
 * @package
 */
Blockly.Frame.prototype.getContainedBlocks = function() {
  var frames = this.workspace.getTopFrames();
  var blocks = this.workspace.getTopBlocks(false);
  var contained = [];
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (!this.containsPoint(block.getBoundingRectangle().topLeft)) {
      continue;
    }
    // Only the smallest frame containing the block owns it.
    var smallest = this;
    for (var j = 0; j < frames.length; j++) {
      var other = frames[j];
      if (other != this &&
          other.containsPoint(block.getBoundingRectangle().topLeft) &&
          other.area_() < smallest.area_()) {
        smallest = other;
      }
    }
    if (smallest == this) {
      contained.push(block);
    }
  }
  return contained;
};

/**
 * @return {number} The area of the frame's expanded rectangle.
 * @private
 */
Blockly.Frame.prototype.area_ = function() {
  return this.width_ * this.height_;
};

/**
 * Is the given point inside the frame's expanded rectangle? Uses the expanded
 * rectangle even while collapsed, so that a collapsed frame still knows which
 * scripts are its own.
 * @param {!goog.math.Coordinate} xy The point, in workspace units.
 * @return {boolean} True if the point is inside the frame.
 * @package
 */
Blockly.Frame.prototype.containsPoint = function(xy) {
  return xy.x >= this.xy_.x && xy.x <= this.xy_.x + this.width_ &&
      xy.y >= this.xy_.y && xy.y <= this.xy_.y + this.height_;
};

/**
 * Grow the frame so that every block inside it fits. Frames never shrink on
 * their own: the size the user dragged them to is a floor.
 * @package
 */
Blockly.Frame.prototype.growToFitBlocks = function() {
  if (this.collapsed_ || this.dragMembers_) {
    return;
  }
  var blocks = this.getContainedBlocks();
  if (!blocks.length) {
    return;
  }

  var pad = Blockly.Frame.PADDING;
  var right = this.xy_.x + this.width_;
  var bottom = this.xy_.y + this.height_;
  for (var i = 0; i < blocks.length; i++) {
    var box = blocks[i].getBoundingRectangle();
    right = Math.max(right, box.bottomRight.x + pad);
    bottom = Math.max(bottom, box.bottomRight.y + pad);
  }

  var width = right - this.xy_.x;
  var height = bottom - this.xy_.y;
  if (width == this.width_ && height == this.height_) {
    return;
  }

  Blockly.Events.fire(new Blockly.Events.FrameChange(this,
      {width: this.width_, height: this.height_},
      {width: width, height: height}));
  this.setSize(width, height);
};

/**
 * Show or hide the blocks inside the frame.
 * @param {boolean} visible Whether the blocks should be visible.
 * @private
 */
Blockly.Frame.prototype.setMembersVisible_ = function(visible) {
  var blocks = this.getMembers();
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].getSvgRoot().style.display = visible ? '' : 'none';
  }
};

/**
 * Collapse or expand the frame. Collapsing hides the scripts inside it and
 * pulls everything below the frame up into the space it freed, which is the
 * whole point of collapsing it.
 * @param {boolean} collapsed Whether the frame should be collapsed.
 * @package
 */
Blockly.Frame.prototype.setCollapsed = function(collapsed) {
  if (this.collapsed_ == collapsed) {
    return;
  }
  // Read the members before the collapsed flag changes which list is in use.
  var members = this.getMembers();
  var oldIds = this.blockIds_;
  var newIds = [];
  if (collapsed) {
    for (var i = 0; i < members.length; i++) {
      newIds.push(members[i].id);
    }
  }

  Blockly.Events.fire(new Blockly.Events.FrameChange(this,
      {collapsed: this.collapsed_, blockIds: oldIds},
      {collapsed: collapsed, blockIds: newIds}));

  var delta = this.height_ - Blockly.Frame.TOP_BAR_HEIGHT;

  this.collapsed_ = collapsed;
  this.blockIds_ = newIds;
  this.shiftContentBelow_(members, collapsed ? -delta : delta);

  for (var j = 0; j < members.length; j++) {
    members[j].getSvgRoot().style.display = collapsed ? 'none' : '';
  }
  this.updateCollapseIcon_();

  this.setSize(this.width_, this.height_);
  this.workspace.resizeContents();
};

/**
 * Move everything sitting below the frame up or down, so that collapsing the
 * frame actually reclaims the space it was taking up. The frame's own blocks
 * are left where they are: they get hidden instead.
 * @param {!Array.<!Blockly.BlockSvg>} members The blocks inside this frame.
 * @param {number} dy How far to move things, in workspace units.
 * @private
 */
Blockly.Frame.prototype.shiftContentBelow_ = function(members, dy) {
  if (!dy) {
    return;
  }
  // Things below the frame as it is drawn right now.
  var threshold = this.xy_.y +
      (dy < 0 ? this.height_ : Blockly.Frame.TOP_BAR_HEIGHT);

  var blocks = this.workspace.getTopBlocks(false);
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (members.indexOf(block) != -1) {
      continue;
    }
    if (block.getBoundingRectangle().topLeft.y >= threshold) {
      block.moveBy(0, dy);
    }
  }

  var frames = this.workspace.getTopFrames();
  for (var j = 0; j < frames.length; j++) {
    var frame = frames[j];
    if (frame != this && frame.getXY().y >= threshold) {
      frame.moveBy(0, dy);
    }
  }
};

/**
 * Handle a mouse-down on one of the title bar icons. Arms the icon, and stops
 * the click from starting a drag of the frame.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.iconMouseDown_ = function(e) {
  this.iconArmed_ = true;
  e.stopPropagation();
  e.preventDefault();
};

/**
 * Disarm an icon when the pointer leaves it, so that dragging off the icon
 * does not trigger it.
 * @private
 */
Blockly.Frame.prototype.iconMouseOut_ = function() {
  this.iconArmed_ = false;
};

/**
 * Toggle the frame's collapsed state.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.Frame.prototype.collapseMouseUp_ = function(e) {
  if (this.iconArmed_) {
    this.iconArmed_ = false;
    Blockly.Events.setGroup(true);
    try {
      this.setCollapsed(!this.collapsed_);
    } finally {
      Blockly.Events.setGroup(false);
    }
  }
  e.stopPropagation();
};

/**
 * Delete the frame.
 * @param {!Event} e Mouse up event.
 * @private
 */
Blockly.Frame.prototype.deleteMouseUp_ = function(e) {
  if (this.iconArmed_) {
    this.iconArmed_ = false;
    Blockly.Events.setGroup(true);
    try {
      this.dispose();
    } finally {
      Blockly.Events.setGroup(false);
    }
  }
  e.stopPropagation();
};

/**
 * Start resizing the frame from its corner handle.
 * @param {!Event} e Mouse down event.
 * @private
 */
Blockly.Frame.prototype.resizeMouseDown_ = function(e) {
  this.resizeStartSize_ = {width: this.width_, height: this.height_};
  this.workspace.setResizesEnabled(false);
  Blockly.hideChaff();

  this.onMouseUpWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mouseup', this, this.resizeMouseUp_);
  this.onMouseMoveWrapper_ = Blockly.bindEventWithChecks_(
      document, 'mousemove', this, this.resizeMouseMove_);

  this.workspace.startDrag(e, new goog.math.Coordinate(
      this.workspace.RTL ? -this.width_ : this.width_, this.height_));

  e.stopPropagation();
};

/**
 * Resize the frame as the pointer moves.
 * @param {!Event} e Mouse move event.
 * @private
 */
Blockly.Frame.prototype.resizeMouseMove_ = function(e) {
  var newXY = this.workspace.moveDrag(e);
  // One change event is fired at the end of the resize instead.
  Blockly.Events.disable();
  try {
    this.setSize(this.workspace.RTL ? -newXY.x : newXY.x, newXY.y);
  } finally {
    Blockly.Events.enable();
  }
};

/**
 * Finish resizing the frame, and record the change for undo.
 * @private
 */
Blockly.Frame.prototype.resizeMouseUp_ = function() {
  Blockly.Touch.clearTouchIdentifier();
  this.unbindDragEvents_();

  var oldSize = this.resizeStartSize_;
  this.resizeStartSize_ = null;
  this.workspace.setResizesEnabled(true);

  if (oldSize && (oldSize.width != this.width_ ||
      oldSize.height != this.height_)) {
    Blockly.Events.fire(new Blockly.Events.FrameChange(this,
        {width: oldSize.width, height: oldSize.height},
        {width: this.width_, height: this.height_}));
  }
};

/**
 * Stop listening for the resize drag.
 * @private
 */
Blockly.Frame.prototype.unbindDragEvents_ = function() {
  if (this.onMouseUpWrapper_) {
    Blockly.unbindEvent_(this.onMouseUpWrapper_);
    this.onMouseUpWrapper_ = null;
  }
  if (this.onMouseMoveWrapper_) {
    Blockly.unbindEvent_(this.onMouseMoveWrapper_);
    this.onMouseMoveWrapper_ = null;
  }
};

/**
 * Show the frame's context menu.
 * @param {!Event} e Mouse event.
 * @package
 */
Blockly.Frame.prototype.showContextMenu_ = function(e) {
  if (this.workspace.options.readOnly) {
    return;
  }
  var frame = this;
  var options = [];

  options.push({
    text: Blockly.Msg.RENAME_FRAME,
    enabled: true,
    callback: function() {
      frame.startEditingTitle();
    }
  });

  options.push({
    text: this.collapsed_ ? Blockly.Msg.EXPAND_FRAME : Blockly.Msg.COLLAPSE_FRAME,
    enabled: true,
    callback: function() {
      Blockly.Events.setGroup(true);
      try {
        frame.setCollapsed(!frame.isCollapsed());
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  });

  options.push({
    text: Blockly.Msg.DELETE_FRAME,
    enabled: true,
    callback: function() {
      Blockly.Events.setGroup(true);
      try {
        frame.dispose();
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  });

  Blockly.ContextMenu.show(e, options, this.workspace.RTL);
};

/**
 * Dispose of the frame. The scripts inside it are left alone, unless the frame
 * is being dropped on a delete area mid-drag, in which case they travelled
 * into it with the frame and go with it.
 * @package
 */
Blockly.Frame.prototype.dispose = function() {
  if (!this.workspace) {
    return;
  }
  var members = this.dragMembers_;
  if (members) {
    // Ends the drag, which fires the members' move events, so that undoing the
    // deletion puts them back where the drag started rather than in the
    // delete area.
    this.setDragging(false);
  }
  // Never leave the scripts inside a collapsed frame hidden. When the whole
  // workspace is being torn down the blocks are going away anyway, and
  // un-collapsing would shuffle everything else around on the way out.
  if (this.collapsed_ && !this.workspace.isClearing) {
    this.setCollapsed(false);
  }
  this.unbindDragEvents_();

  if (Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.FrameDelete(this));
  }

  var workspace = this.workspace;
  workspace.removeTopFrame(this);
  goog.dom.removeNode(this.svgGroup_);

  this.svgGroup_ = null;
  this.svgRect_ = null;
  this.svgTopBar_ = null;
  this.workspace = null;

  if (members) {
    for (var i = 0; i < members.length; i++) {
      members[i].dispose(false, true);
    }
  }

  workspace.resizeContents();
};

/**
 * Encode the frame as XML.
 * @return {!Element} The XML element.
 * @package
 */
Blockly.Frame.prototype.toXmlWithXY = function() {
  var element = goog.dom.createDom('frame');
  element.setAttribute('id', this.id);
  element.setAttribute('x', Math.round(this.xy_.x));
  element.setAttribute('y', Math.round(this.xy_.y));
  element.setAttribute('w', Math.round(this.width_));
  element.setAttribute('h', Math.round(this.height_));
  element.setAttribute('collapsed', this.collapsed_);
  if (this.collapsed_ && this.blockIds_.length) {
    element.setAttribute('blocks', this.blockIds_.join(','));
  }
  element.textContent = this.title_;
  return element;
};

/**
 * Create a frame from XML.
 * @param {!Element} xmlFrame The XML element.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to put the frame on.
 * @return {!Blockly.Frame} The created frame.
 * @package
 */
Blockly.Frame.fromXml = function(xmlFrame, workspace) {
  var blocks = xmlFrame.getAttribute('blocks');
  return new Blockly.Frame(workspace, {
    id: xmlFrame.getAttribute('id'),
    blockIds: blocks ? blocks.split(',') : [],
    title: xmlFrame.textContent || '',
    x: parseInt(xmlFrame.getAttribute('x'), 10) || 0,
    y: parseInt(xmlFrame.getAttribute('y'), 10) || 0,
    width: parseInt(xmlFrame.getAttribute('w'), 10) || Blockly.Frame.DEFAULT_WIDTH,
    height: parseInt(xmlFrame.getAttribute('h'), 10) || Blockly.Frame.DEFAULT_HEIGHT,
    collapsed: xmlFrame.getAttribute('collapsed') == 'true'
  });
};

/**
 * Grow every frame on the workspace to fit the blocks inside it. Called when
 * blocks are created, moved, changed, or deleted, which is when the set of
 * blocks inside a frame can change.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace.
 * @param {!Blockly.Events.Abstract} event The event that just happened.
 * @package
 */
Blockly.Frame.onWorkspaceChange = function(workspace, event) {
  if (event.type != Blockly.Events.CREATE &&
      event.type != Blockly.Events.MOVE &&
      event.type != Blockly.Events.DELETE &&
      event.type != Blockly.Events.CHANGE) {
    return;
  }
  var frames = workspace.getTopFrames();
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    if (frame.isCollapsed()) {
      // A frame can be loaded already collapsed, and its blocks arrive after
      // it does, so keep hiding them as they turn up.
      frame.setMembersVisible_(false);
    } else {
      frame.growToFitBlocks();
    }
  }
};
