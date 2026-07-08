import React, {Component} from "react";
import {observer, inject} from "mobx-react";

import {RIGHT_SYMBOL} from "../../../utils/constant";
import "../common.css";

@inject("view")
@observer
class ExamDiagnostics extends Component {
  handleClick = () => {
    const {isExamDiagnosticsEnabled} = this.props.view;
    this.props.view.setExamDiagnosticsEnabled(!isExamDiagnosticsEnabled);
  };

  render() {
    return (
      <div id="nice-menu-exam-diagnostics" className="nice-menu-item" onClick={this.handleClick}>
        <span>
          <span className="nice-menu-flag">
            {this.props.view.isExamDiagnosticsEnabled && <span>{RIGHT_SYMBOL}</span>}
          </span>
          <span className="nice-menu-name">试卷检查</span>
        </span>
      </div>
    );
  }
}

export default ExamDiagnostics;
