import React, {Component} from "react";
import {observer, inject} from "mobx-react";

import {RIGHT_SYMBOL} from "../../../utils/constant";
import "../common.css";

@inject("navbar")
@observer
class PasteImageUpload extends Component {
  handleClick = () => {
    const {isPasteImageUpload} = this.props.navbar;
    this.props.navbar.setPasteImageUpload(!isPasteImageUpload);
  };

  render() {
    return (
      <div id="nice-menu-paste-image-upload" className="nice-menu-item" onClick={this.handleClick}>
        <span>
          <span className="nice-menu-flag">{this.props.navbar.isPasteImageUpload && <span>{RIGHT_SYMBOL}</span>}</span>
          <span className="nice-menu-name">粘贴图片时使用图床</span>
        </span>
      </div>
    );
  }
}

export default PasteImageUpload;
