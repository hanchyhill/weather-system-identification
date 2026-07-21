"""针对指定个例快速调整高空槽识别参数并输出对比图。"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt

from trough import plot_trough_analysis
from weather_common import DEFAULT_SOURCE, format_fc_hour


# 固定个例：脚本只处理这里列出的起报时次、预报时效和气压层。
INIT_TIME = '2026072012'
FC_HOURS = ('036', '042')
TARGET_LEVELS = (500, 850)  # hPa
OUTPUT_DIR = Path('demo/trough_debug') / INIT_TIME

# 调参区。每次修改后直接重新运行本脚本，图像和JSON会被覆盖。
DEBUG_CONFIG = {
    # 聚类连接：越小越不容易把相邻槽线串在一起。
    'interval_dis': 1.0,

    # 分段后不足此累计长度（经纬度度数）的短线会被丢弃。最重要的聚类连接阈值。越小越不容易把两条槽线串起来；太小会造成槽线断裂。生产原值为 2.0。
    'length_min': 4.0,

    # 拆分后的独立最小长度；0表示保留所有至少包含两个点的截断部分。
    'segment_length_min': 3.5,

    # 超过此累计长度时，递归选择原始相邻点最大间隙处断开。最大累计长度，单位为经纬度度数。超过后递归从原始相邻点间隙最大的地方断开。越小拆分越积极。
    'max_line_length': 20.0,

    # 局部转向角大于此值时拆线；越小越严格，None表示关闭。0° 表示直行，数值越小，对弯曲越严格。
    'max_turn_angle': 120.0,

    # 转向角计算窗口；3表示比较当前点前后各3个原始点的方向。
    'turn_angle_window': 3,

    # 仅影响绘图：相邻拆分段端点距离不超过1°时，各裁短0.3°形成可见间隔。
    # JSON中的原始点和完整贝塞尔点不会被裁剪。
    'visual_gap_distance': 1.0,
    'visual_gap_length': 0.3,

    # 显示四类全部原始候选切变点，包括未参与拟合的点；使用实心点而非圆圈。
    'show_all_raw_points': True,
    'raw_point_size': 4.0,

    # 平滑只影响显示和smoothed_points，不影响上述原始点拆线判定。
    'smooth_method': 'bezier',
    'num_points': 100,
    'num_control_points': 5, # 贝塞尔曲线控制点数量
    'smoothness': 6,
    'barb_skip': 8,
    'figsize': (10, 8),
    'dpi': 150,
    # 四类切变点可分别调过滤阈值；angle_threshold是整条线的首-中-尾夹角。
    'shear_types': {
        'shear_u_left': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 2.0,
            'angle_threshold': 90.0,
            'color': 'blue',
            'linewidth': 1.0,
            'label': 'Shear U Left',
        },
        'shear_u_right': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 2.0,
            'angle_threshold': 90.0,
            'color': 'green',
            'linewidth': 1.0,
            'label': 'Shear U Right',
        },
        'shear_v_up': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 3.0,
            'angle_threshold': 90.0,
            'color': 'red',
            'linewidth': 1.0,
            'label': 'Shear V Up',
        },
        'shear_v_down': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 3.0,
            'angle_threshold': 90.0,
            'color': 'orange',
            'linewidth': 1.0,
            'label': 'Shear V Down',
        },
    },
}


def run_debug_cases():
    """覆盖输出两个固定时效、500/850 hPa槽线调试图与JSON。"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summaries = []

    for fc_hour in FC_HOURS:
        fc_hour = format_fc_hour(fc_hour)
        for target_level in TARGET_LEVELS:
            print(f'处理高空槽个例: {INIT_TIME} +{fc_hour}h {target_level}hPa')
            fig, trough_data = plot_trough_analysis(
                init_time=INIT_TIME,
                fc_hour=fc_hour,
                target_lev=target_level,
                source=DEFAULT_SOURCE,
                config=DEBUG_CONFIG,
                create_plot=True,
            )

            stem = f'trough_debug_{INIT_TIME}_{fc_hour}_{target_level}hPa'
            image_path = OUTPUT_DIR / f'{stem}.png'
            json_path = OUTPUT_DIR / f'{stem}.json'
            fig.savefig(image_path, bbox_inches='tight')
            plt.close(fig)
            with json_path.open('w', encoding='utf-8') as json_file:
                json.dump(trough_data, json_file, ensure_ascii=False, indent=2)

            summary = {
                'fc_hour': fc_hour,
                'target_level': target_level,
                'trough_line_count': len(trough_data['trough_lines']),
                'image_path': str(image_path),
                'json_path': str(json_path),
            }
            summaries.append(summary)
            print(
                f"  输出 {summary['trough_line_count']} 条槽线: "
                f"{image_path}"
            )

    return summaries


if __name__ == '__main__':
    run_debug_cases()
