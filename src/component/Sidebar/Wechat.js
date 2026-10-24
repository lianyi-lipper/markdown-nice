import React, {Component} from "react";
import {observer, inject} from "mobx-react";
import {message, Tooltip} from "antd";

import {solveWeChatMath, solveHtml, copySafari} from "../../utils/converter";
import {LAYOUT_ID, ENTER_DELAY, LEAVE_DELAY} from "../../utils/constant";
import SvgIcon from "../../icon";
import "./Wechat.css";
import {compatibleImages} from "../../utils/compatibleImages";

@inject("content")
@inject("navbar")
@inject("imageHosting")
@inject("dialog")
@observer
class Wechat extends Component {
  constructor(props) {
    super(props);
    this.html = "";
  }

  copyWechat = async () => {
    if (this.copying) return;
    this.copying = true;
    const layout = document.getElementById(LAYOUT_ID); // 保护现场
    const html = layout.innerHTML;
    try {
      try {
        solveWeChatMath();
        this.html = solveHtml();
      } finally {
        layout.innerHTML = html; // 在异步转换前恢复现场
      }
      this.html = await compatibleImages(this.html);
      copySafari(this.html);
      message.success("已复制，请到微信公众平台粘贴");
    } catch (error) {
      message.error("图片转换失败，未复制：" + error.message);
    } finally {
      this.copying = false;
    }
  };

  render() {
    return (
      <Tooltip placement="left" mouseEnterDelay={ENTER_DELAY} mouseLeaveDelay={LEAVE_DELAY} title="复制到公众号">
        <a id="nice-sidebar-wechat" className="nice-btn-wechat" onClick={this.copyWechat}>
          <SvgIcon name="wechat" className="nice-btn-wechat-icon" />
        </a>
      </Tooltip>
    );
  }
}

export default Wechat;
