SELECT
  DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS database_time,
  @@session.time_zone AS session_timezone,
  DATE_FORMAT(FROM_UNIXTIME((SELECT MAX(createtime) FROM ob_user)), '%Y-%m-%d %H:%i:%s') AS latest_user,
  DATE_FORMAT(FROM_UNIXTIME((SELECT MAX(createtime) FROM ob_sendorder)), '%Y-%m-%d %H:%i:%s') AS latest_sendorder,
  DATE_FORMAT(FROM_UNIXTIME((SELECT MAX(createtime) FROM ob_order_goods)), '%Y-%m-%d %H:%i:%s') AS latest_package,
  DATE_FORMAT(FROM_UNIXTIME((SELECT MAX(createtime) FROM ob_coupon)), '%Y-%m-%d %H:%i:%s') AS latest_coupon;
