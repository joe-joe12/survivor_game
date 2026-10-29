extends CharacterBody2D

@export var move_speed: float = 150.0
@export var bullet_scene: PackedScene
@export var attack_interval: float = 1.0

var experience: int = 0
var level: int = 1
var exp_to_next_level: int = 5

@onready var attack_timer: Timer = $AttackTimer

func _ready() -> void:
	add_to_group("player")
	attack_timer.wait_time = attack_interval
	attack_timer.timeout.connect(_on_attack_timer_timeout)
	attack_timer.start()

func _physics_process(_delta: float) -> void:
	var input_dir = Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	velocity = input_dir * move_speed
	move_and_slide()

func _on_attack_timer_timeout() -> void:
	var target_enemy = get_nearest_enemy()
	if target_enemy and bullet_scene:
		var bullet = bullet_scene.instantiate()
		bullet.global_position = global_position
		bullet.direction = (target_enemy.global_position - global_position).normalized()
		get_parent().add_child(bullet)

func get_nearest_enemy() -> Node2D:
	var enemies = get_tree().get_nodes_in_group("enemies")
	var nearest_enemy: Node2D = null
	var shortest_distance: float = INF
	
	for enemy in enemies:
		var distance = global_position.distance_to(enemy.global_position)
		if distance < shortest_distance:
			shortest_distance = distance
			nearest_enemy = enemy
			
	return nearest_enemy

func add_experience(amount: int) -> void:
	experience += amount
	print("獲得經驗值！目前總經驗：", experience)
	if experience >= exp_to_next_level:
		level_up()

func level_up() -> void:
	experience -= exp_to_next_level
	level += 1
	exp_to_next_level = int(exp_to_next_level * 1.5)
	attack_timer.wait_time = max(0.2, attack_timer.wait_time * 0.9)
	move_speed += 10.0
	print("★ 升級！目前等級：", level, " | 攻擊間隔：", attack_timer.wait_time)
