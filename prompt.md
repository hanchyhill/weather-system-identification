## 修改trough.py 文件

1. 拆分出可复用模块
2. 构建 get_multi_fc_trough_by_init_time 函数，输入指定初始时间，输出多个预报小时，各个层次的槽线数据。
3. plot_trough_analysis 当中返回图像的句柄，以及槽线数据，不再plt.show()。
4. get_multi_fc_trough_by_init_time 当中，负责保存图像，把槽线数据转换成json文件，保存到本地。
5. 图像的保存路径为：./data/init_time/trough_images/trough_init_time_fc_hour_ecmwf.png，其中init_time为初始时间，fc_hour为预报小时
6. 槽线数据转换成json文件的保存路径为：./data/init_time/trough_data/trough_init_time_fc_hour_ecmwf.json，其中init_time为初始时间，fc_hour为预报小时.
7. 帮我确定json文件的格式，以及槽线数据的结构。

8. 可用的 fc_hour: timeStrList_ecmwfthin = ['000', '003', '006', '009', '012', '015', '018', '021', '024', '027', '030', '033', '036', '039', '042', '045', '048', '051', '054', '057', '060', '063', '066', '069', '072', '078',  '084',  '090',
               '096',  '102',  '108',  '114',  '120',  '126',  '132',  '138',  '144', '150', '156', '162', '168', '174', '180', '186', '192', '198', '204', '210', '216', '222', '228', '234', '240']
9. target_lev: target_lev_list = [200, 500, 850, 925, 950, 1000]