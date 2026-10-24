import React, {Component} from "react";
import {inject, observer} from "mobx-react";

@inject("dialog")
@observer
class CreateCover extends Component {
  render() {
    return (
      <button
        type="button"
        id="nice-menu-create-cover"
        className="nice-menu-item"
        onClick={() => this.props.dialog.setCoverOpen(true)}
      >
        <span>
          <span className="nice-menu-flag" />
          <span className="nice-menu-name">公众号封面</span>
        </span>
      </button>
    );
  }
}

export default CreateCover;
